"""
Agent toolset: web (search + scrape), HTTP APIs, shell execution, sandboxed filesystem.

What's new in this version
--------------------------
New tools:
  * run_command  - shell execution with safety rails (denylist, hard timeout with
                   process-tree kill, scrubbed environment, stdin closed, output caps,
                   host-side audit log, ENABLE_SHELL kill switch)
  * http_request - lightweight JSON/API calls without launching a browser
  * search_files - find files/folders by glob pattern
  * grep         - search the contents of sandbox files
  * get_time     - current date/time for the agent

Fixes / improvements:
  * UTF-8 encoding everywhere (Windows cp1252 default broke Unicode content)
  * read_file: line-based offsets (text-mode byte seek was broken) + truncation notice
  * write_file: auto-creates parent folders, size cap
  * edit_file: reports occurrence count, no longer echoes huge strings
  * validate_path: realpath (symlink/junction escapes), drive-letter handling,
    case-insensitive containment check
  * delete_file: refuses to delete the sandbox root
  * move/copy: no silent overwrites (auto-renames collisions)
  * URL heuristic: stricter domain check so queries like "v1.2.3" aren't mistaken
    for URLs; bare domains now validated correctly in web_search
  * Multi-link crawling is concurrent (one shared browser, semaphore-limited)
  * crawl4ai >= 0.6 modern API (BrowserConfig / CrawlerRunConfig) with legacy fallback
  * Consistent output-size caps on every tool that returns web/text content

Host-side helpers (bottom of this file):
  * get_tool_schemas()    - generate OpenAI function-calling schemas straight from
                            the docstrings + type hints below (no hand-written JSON)
  * build_tool_registry() - build the name -> method registry with the same filters
  * build_tools()         - one call that returns (registry, schemas) guaranteed in sync
"""

import os
import re
import json
import shutil
import asyncio
import fnmatch
import signal
import inspect
import subprocess
import types
import urllib.parse
from datetime import datetime
from typing import Union, get_args, get_origin

try:
    from ddgs import DDGS
except ImportError:  # web tools degrade gracefully if ddgs is missing
    DDGS = None

# --------------------------------------------------------------------------------------
# Configuration / safety limits (tune these at the top)
# --------------------------------------------------------------------------------------
BASE_DIR = os.getcwd()
ALLOWED_DIR = os.path.join(BASE_DIR, "sandbox")
os.makedirs(ALLOWED_DIR, exist_ok=True)

# Audit log lives OUTSIDE the sandbox so the agent cannot rewrite its own trail.
AUDIT_LOG = os.path.join(BASE_DIR, "shell_audit.log")

ENABLE_SHELL = True           # master kill switch for run_command
MAX_COMMAND_LEN = 4_000       # chars per command line
MAX_SHELL_TIMEOUT = 600       # hard cap (seconds) for the timeout argument
MAX_SHELL_OUTPUT = 10_000     # chars per output stream
MAX_READ_CHARS = 20_000       # chars per read_file call (no explicit length)
MAX_WRITE_CHARS = 1_000_000   # chars per write_file call
MAX_SCRAPE_CHARS = 15_000     # chars returned by scrape() / direct URL fetch
MAX_SEARCH_CHARS = 4_000      # chars per source in web_search / scrape fallback
MAX_HTTP_CHARS = 20_000       # chars returned by http_request

# --------------------------------------------------------------------------------------
# Shell denylist - best-effort protection against catastrophic commands.
# NOTE: a denylist is NOT a real sandbox and can be bypassed (e.g. `python -c ...`,
# `powershell -enc ...`). For strong isolation, run the agent inside a container/VM
# (Docker, Windows Sandbox). This list only stops obvious disasters.
# --------------------------------------------------------------------------------------
DANGEROUS_PATTERNS = [
    # privilege escalation / policy tampering
    r"\bsudo\b",
    r"\bsu\s+(-\s+)?\w",
    r"\bset-executionpolicy\b",
    r"\binvoke-expression\b|\biex\b",
    r"\bstart-process\b[^|;&]*-verb\s+runas",
    # *nix destruction
    r"\brm\b[^|;&]*\s(/|~|\$home|\.\.)",          # rm touching absolute/home/parent paths
    r"\bmkfs(\.[a-z0-9]+)?\b",
    r"\bdd\b[^|;&]*\bof=/dev/",
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",  # fork bomb
    r"\b(shutdown|reboot|halt|poweroff)\b",
    r"\b(init|telinit)\s+[06]\b",
    r"\bchmod\s+-r\s+777\s+/",
    r">>?\s*/(etc|usr|bin|sbin|boot|sys|proc|dev)\b",
    r"\btee\s+/(etc|usr|bin|sbin|boot)\b",
    # windows destruction
    r"\bformat\s+[a-z]:",
    r"\bdel\s+/s\b",
    r"\bdel\b[^|;&]*\s[a-z]:\\",
    r"\b(rd|rmdir)\s+/s\b",
    r"\bremove-item\b[^|;&]*-recurse\b",
    r">>?\s*[a-z]:\\(windows|program)",
    r"\bdiskpart\b",
    r"\bbcdedit\b",
    r"\bvssadmin\b",
    r"\bwbadmin\b",
    r"\bcipher\s+/w\b",
    r"\breg\b\s+(delete|add|restore|import)\b",
    r"\bnet\s+user\b[^|;&]*\b/add\b",
    r"\bnetsh\b[^|;&]*\badvfirewall\b",
    r"\bschtasks\b",
    r"\biisreset\b",
    # remote code execution patterns
    r"\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|fi)?sh\b",
]
_DANGEROUS_RE = [re.compile(p, re.IGNORECASE) for p in DANGEROUS_PATTERNS]


class Tools:
    # Stealth browser args (shared by all crawler versions)
    STEALTH_ARGS = [
        "--disable-blink-features=AutomationControlled,WebAutomation",
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-crash-reporter",
        "--disable-logging",
        "--font-render-hinting=none",
    ]

    # Stricter URL heuristic: domain-shaped text ending in an ALPHABETIC TLD.
    # "v1.2.3" -> no (TLD "3" is not alphabetic), "docs.python.org" -> yes.
    _URL_RE = re.compile(
        r"^(https?://)?"
        r"([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+"
        r"[a-z]{2,24}"
        r"(:\d{2,5})?"
        r"([/?#].*)?$",
        re.IGNORECASE,
    )

    # Directories skipped when walking the sandbox
    _SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".trash"}

    # Environment variables passed through to shell commands (everything else is
    # scrubbed so host secrets such as API keys are invisible to the agent's commands)
    _ENV_KEEP = [
        "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM",
        "SystemRoot", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP",
        "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramData",
        "HOMEDRIVE", "HOMEPATH", "USERNAME",
    ]

    # ------------------------------------------------------------------ URL helpers

    def validate_url(self, url: str) -> str:
        """
        Return the URL unchanged if it uses an allowed scheme (http/https) and has
        a host. Raise ValueError for anything else (file:, ftp:, javascript:, ...).
        """
        parsed = urllib.parse.urlparse((url or "").strip())
        scheme = parsed.scheme.lower()

        if scheme not in ("http", "https"):
            raise ValueError(
                f"Access denied: URL scheme '{scheme or '(none)'}' is not allowed. "
                "Only http(s) URLs are permitted."
            )
        if not parsed.netloc:
            raise ValueError(f"Access denied: URL '{url}' has no host.")

        return urllib.parse.urlunparse((
            scheme, parsed.netloc, parsed.path,
            parsed.params, parsed.query, parsed.fragment,
        ))

    def _looks_like_url(self, text: str) -> bool:
        """Stricter than 'contains a dot': requires domain-shaped text with an
        alphabetic TLD, so queries like 'v1.2.3 changelog' are not treated as URLs."""
        text = (text or "").strip()
        if not text or " " in text or "\n" in text:
            return False
        if text.startswith("http://") or text.startswith("https://"):
            return True
        return bool(self._URL_RE.match(text))

    # ------------------------------------------------------------------ crawler core

    def _profile_dir(self) -> str:
        profile_dir = os.path.join(os.path.expanduser("~"), ".cache", "crawl4ai_profile")
        os.makedirs(profile_dir, exist_ok=True)
        return profile_dir

    def _crawler_kwargs(self) -> dict:
        """Legacy kwargs for crawl4ai < 0.6 (persistent profile + stealth args)."""
        return {
            "verbose": False,
            "headless": True,
            "browser_args": self.STEALTH_ARGS,
            "user_data_dir": self._profile_dir(),
        }

    def _new_crawler(self):
        """AsyncWebCrawler factory. Prefers the modern BrowserConfig API
        (crawl4ai >= 0.6) and falls back to legacy kwargs on older versions."""
        from crawl4ai import AsyncWebCrawler
        try:
            from crawl4ai import BrowserConfig
            cfg = BrowserConfig(
                verbose=False,
                headless=True,
                extra_args=self.STEALTH_ARGS,  # BrowserConfig field (legacy kwargs use browser_args)
                user_data_dir=self._profile_dir(),
            )
            return AsyncWebCrawler(config=cfg)
        except ImportError:
            return AsyncWebCrawler(**self._crawler_kwargs())

    async def _arun(self, crawler, url: str, word_count: int = 500):
        """Crawl one page. Uses CrawlerRunConfig on crawl4ai >= 0.6, legacy kwargs otherwise."""
        try:
            from crawl4ai import CrawlerRunConfig
            cfg = CrawlerRunConfig(word_count_threshold=word_count, page_timeout=45_000)
            return await crawler.arun(url=url, config=cfg)
        except (ImportError, TypeError):
            return await crawler.arun(url=url, word_count=word_count)

    def run_crawl_sync(self, url: str):
        """Crawl a URL with Crawl4AI (3 attempts, brief delay between tries);
        returns markdown or None on failure."""
        async def _crawl():
            attempts = 0
            while attempts < 3:
                attempts += 1
                try:
                    async with self._new_crawler() as crawler:
                        result = await self._arun(crawler, url, 500)
                        if result and result.markdown and len(result.markdown.strip()) > 100:
                            return result.markdown
                except Exception as e:
                    print(f"Crawl attempt {attempts} failed for {url}: {e}")
                if attempts < 3:
                    await asyncio.sleep(1.5)
            return None

        return asyncio.run(_crawl())

    def run_crawl_multi_sync(self, links: list, word_count: int = 300, max_concurrent: int = 3):
        """Crawl multiple links CONCURRENTLY with one shared browser instance
        (semaphore-limited parallelism). Returns a list of (link, markdown, error)
        tuples in the same order as `links`."""
        links = [l for l in links if l]
        if not links:
            return []

        async def _crawl():
            sem = asyncio.Semaphore(max(1, int(max_concurrent)))
            results: list[tuple[str, str | None, str | None]] = [
                (link, None, "Not crawled") for link in links
            ]

            async def _one(i, link):
                async with sem:
                    try:
                        result = await self._arun(crawler, link, word_count)
                        md = result.markdown if (result and result.markdown) else None
                        results[i] = (link, md, None if md else "Failed to scrape")
                    except Exception as e:
                        results[i] = (link, None, str(e))

            async with self._new_crawler() as crawler:
                await asyncio.gather(*[_one(i, l) for i, l in enumerate(links)])
            return results

        return asyncio.run(_crawl())

    # ------------------------------------------------------------------ web tools

    async def scrape(self, url: str) -> str:
        """Scrape a URL and return markdown. On failure (or if the input is not a
        URL) it falls back to a DDGS search and scrapes the top 2 results.
        Prefer http_request for plain JSON APIs; use this for articles/JS-heavy pages.

        Args:
            url: The URL (or search phrase) to fetch.
        """
        target = (url or "").strip()
        loop = asyncio.get_running_loop()

        markdown_content = None
        if self._looks_like_url(target):
            target_url = target if target.startswith("http") else "https://" + target
            try:
                target_url = self.validate_url(target_url)
            except ValueError as e:
                return f"Blocked URL: {e}"
            try:
                markdown_content = await loop.run_in_executor(
                    None, self.run_crawl_sync, target_url
                )
            except Exception as e:
                print(f"Direct crawl failed: {e}")

        if markdown_content:
            return markdown_content[:MAX_SCRAPE_CHARS]

        # Fallback: DDGS search -> crawl top links
        if DDGS is None:
            return "ddgs is not installed; the search fallback is unavailable."

        links = []
        try:
            with DDGS(timeout=20) as ddgs:
                for r in ddgs.text(target, max_results=2, backend="lite"):
                    if r.get("href"):
                        links.append(r["href"])
        except Exception as e:
            return f"DDGS failed: {e}"

        if not links:
            return f"No results found on DDGS for: {target}"

        combined = f"# Search Results for: {target}\n\n"
        try:
            crawled = await loop.run_in_executor(None, self.run_crawl_multi_sync, links)
            for i, (link, md, err) in enumerate(crawled):
                body = md[:MAX_SEARCH_CHARS] if md else f"Failed to scrape: {err}"
                combined += f"## Source {i + 1}: {link}\n\n{body}\n\n---\n\n"
        except Exception as e:
            return f"Crawler failed on links: {e}"

        return combined

    async def web_search(self, query: str, max_results: int = 3) -> str:
        """Search the web for real-time information and return page content per hit.
        If `query` is clearly a URL, the page is fetched directly instead.
        Content is capped per source to protect the context window.

        Args:
            query: The search query, topic, or URL to look up.
            max_results: Number of top results to fetch content from (1-10).
        """
        query = (query or "").strip()
        loop = asyncio.get_running_loop()

        # If the "query" is actually a URL, fetch it directly
        if self._looks_like_url(query):
            target_url = query if query.startswith("http") else "https://" + query
            try:
                target_url = self.validate_url(target_url)
            except ValueError as e:
                return f"Blocked URL: {e}"
            md = await loop.run_in_executor(None, self.run_crawl_sync, target_url)
            if not md:
                return f"Could not retrieve content from {target_url}"
            return md[:MAX_SCRAPE_CHARS]

        if DDGS is None:
            return "ddgs is not installed; web_search is unavailable."
        ddgs_cls = DDGS

        try:
            max_results = min(max(int(max_results), 1), 10)
        except (TypeError, ValueError):
            max_results = 3

        def _search():
            with ddgs_cls(timeout=20) as ddgs:
                return list(ddgs.text(query, max_results=max_results, backend="lite"))

        try:
            results = await loop.run_in_executor(None, _search)
            links = [r.get("href") for r in results if r.get("href")]
        except Exception as e:
            return f"Search failed: {e}"

        if not links:
            return f"No search results found for: {query}"

        combined = f"# Search results for: {query}\n\n"
        try:
            crawled = await loop.run_in_executor(None, self.run_crawl_multi_sync, links)
            for i, (link, md, err) in enumerate(crawled):
                combined += f"## Source {i + 1}: {link}\n\n"
                combined += (md[:MAX_SEARCH_CHARS] if md else f"Failed to scrape: {err}")
                combined += "\n\n---\n\n"
        except Exception as e:
            return f"Search succeeded but crawling failed: {e}"

        return combined

    # ------------------------------------------------------------------ HTTP API tool

    def http_request(self, url: str, method: str = "GET",
                     headers: Union[dict, None] = None,
                     body: Union[dict, None] = None, timeout: int = 30) -> str:
        """Call an HTTP API directly (fast, no browser). Much lighter than scrape()
        for JSON endpoints, webhooks, and REST APIs.

        Args:
            url: http(s) URL.
            method: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS.
            headers: Optional dict of request headers.
            body: Optional dict - sent as a JSON request body.
            timeout: Max seconds to wait (1-120).
        """
        url = self.validate_url(url)  # blocks non-http(s) schemes before anything else
        import requests

        method = (method or "GET").upper()
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            raise ValueError(f"Unsupported HTTP method: {method}")
        try:
            timeout = min(max(int(timeout), 1), 120)
        except (TypeError, ValueError):
            timeout = 30

        try:
            resp = requests.request(
                method, url, headers=headers or {}, json=body,
                timeout=timeout, allow_redirects=True,
            )
        except requests.RequestException as e:
            return f"Request failed: {e}"

        try:
            text = json.dumps(resp.json(), indent=2, ensure_ascii=False)
        except ValueError:
            text = resp.text

        ctype = resp.headers.get("content-type", "?")
        return f"HTTP {resp.status_code} | content-type: {ctype}\n{text[:MAX_HTTP_CHARS]}"

    # ------------------------------------------------------------------ shell tool

    def _safe_env(self) -> dict:
        """Minimal environment for child processes so host secrets (API keys,
        tokens, etc.) are not visible to commands the agent runs."""
        env = {k: os.environ[k] for k in self._ENV_KEEP if k in os.environ}
        env.setdefault("PYTHONUNBUFFERED", "1")
        return env

    def _audit(self, line: str):
        """Append an entry to the host-side audit log (outside the sandbox)."""
        try:
            with open(AUDIT_LOG, "a", encoding="utf-8") as f:
                f.write(f"{datetime.now().isoformat(timespec='seconds')} | {line}\n")
        except OSError:
            pass

    def _kill_tree(self, proc):
        """Kill a process and ALL its children (cross-platform)."""
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               capture_output=True, timeout=10)
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def run_command(self, command: str, timeout: int = 120) -> str:
        """Execute a shell command inside the sandbox directory (cwd = ./sandbox).

        Use for: running Python scripts, installing packages (pip), data processing,
        format conversion, git, zipping, and any CLI tool. Prefer http_request for
        JSON APIs and the file tools for file operations.

        Safeguards:
          * best-effort denylist blocks destructive commands (sudo, rm on absolute
            paths, disk formatting, shutdown, curl|sh, registry edits, ...).
            Use the file tools (e.g. delete_file) for paths inside the sandbox.
            NOTE: a denylist is not a real sandbox and can be bypassed via
            `python -c ...`; for strong isolation run the agent in a container/VM.
          * runs with cwd = sandbox and a SCRUBBED environment (host secrets such
            as API keys are not visible to the command)
          * stdin is closed so commands cannot hang waiting for user input
          * hard timeout: on expiry the ENTIRE process tree is killed
          * stdout/stderr are capped to MAX_SHELL_OUTPUT chars each
          * every command + exit code is appended to the host-side audit log
            (shell_audit.log, outside the sandbox, so the agent cannot edit it)

        Args:
            command: The shell command line to execute.
            timeout: Max seconds to wait (5-600); the process tree is killed on expiry.
        """
        if not ENABLE_SHELL:
            return "Shell execution is disabled (ENABLE_SHELL = False)."

        command = (command or "").strip()
        if not command:
            return "Empty command."
        if len(command) > MAX_COMMAND_LEN:
            return f"Blocked: command too long ({len(command)} > {MAX_COMMAND_LEN} chars)."

        for rx in _DANGEROUS_RE:
            m = rx.search(command)
            if m:
                self._audit(f"BLOCKED | {command[:200]}")
                return f"Blocked by safety denylist (matched: {m.group(0)!r})."

        try:
            timeout = min(max(int(timeout), 5), MAX_SHELL_TIMEOUT)
        except (TypeError, ValueError):
            timeout = 120

        if os.name == "nt":
            platform_kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        else:
            platform_kwargs = {"start_new_session": True}

        self._audit(f"RUN     | {command[:500]}")
        try:
            if os.name == "nt":
                proc = subprocess.Popen(
                    command,
                    cwd=ALLOWED_DIR,
                    env=self._safe_env(),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    shell=True,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                )
            else:
                proc = subprocess.Popen(
                    command,
                    cwd=ALLOWED_DIR,
                    env=self._safe_env(),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    shell=True,
                    start_new_session=True,
                )
        except Exception as e:
            return f"Failed to start command: {e}"

        timed_out = False
        try:
            out_b, err_b = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._kill_tree(proc)
            out_b, err_b = proc.communicate()

        stdout = (out_b or b"").decode("utf-8", errors="replace").strip()
        stderr = (err_b or b"").decode("utf-8", errors="replace").strip()
        self._audit(f"EXIT {proc.returncode}" + (" | TIMEOUT" if timed_out else ""))

        parts = []
        if timed_out:
            parts.append(f"TIMEOUT after {timeout}s - process tree killed. Partial output follows.")
        parts.append(f"[stdout]\n{stdout[:MAX_SHELL_OUTPUT] if stdout else '(empty)'}")
        if stderr:
            parts.append(f"[stderr]\n{stderr[:MAX_SHELL_OUTPUT]}")
        parts.append(f"[exit code: {proc.returncode}]")

        text = "\n".join(parts)
        if len(text) > 2 * MAX_SHELL_OUTPUT:
            text = text[: 2 * MAX_SHELL_OUTPUT] + "\n[output truncated]"
        return text

    # ------------------------------------------------------------------ filesystem tools

    def validate_path(self, file_path):
        """Resolve file_path relative to ALLOWED_DIR and block every escape:
        '..', absolute paths, Windows drive letters, and symlinks/junctions that
        point outside the sandbox. Returns the absolute sandbox path."""
        if not isinstance(file_path, str) or not file_path.strip():
            raise ValueError("Invalid path: empty or not a string.")

        normalized = os.path.normpath(file_path.strip())
        normalized = normalized.lstrip("/\\")
        if re.match(r"^[A-Za-z]:", normalized):  # Windows drive letter survived normpath
            normalized = normalized[2:].lstrip("/\\")
        if not normalized:
            normalized = "."

        abs_path = os.path.realpath(os.path.join(ALLOWED_DIR, normalized))
        allowed_abs = os.path.realpath(ALLOWED_DIR)

        if os.path.normcase(abs_path) != os.path.normcase(allowed_abs) and \
           not os.path.normcase(abs_path).startswith(os.path.normcase(allowed_abs) + os.sep):
            raise ValueError("Access denied: path escapes the allowed directory.")

        return abs_path

    def read_file(self, file_path, offset=0, length=None):
        """Read a UTF-8 text file from the sandbox. Large reads are truncated with
        a notice that tells you the next offset to continue from.

        Args:
            file_path: Path relative to the sandbox.
            offset: 1-based LINE number to start from (default 1). Use it to page
                    through long files.
            length: Max characters to return (optional).
        """
        safe_path = self.validate_path(file_path)
        if not os.path.isfile(safe_path):
            raise FileNotFoundError(f"Not a file: {file_path}")

        try:
            start_line = max(1, int(offset or 1))
        except (TypeError, ValueError):
            start_line = 1

        if length is not None:
            try:
                cap = max(1, min(int(length), 100_000))
            except (TypeError, ValueError):
                cap = MAX_READ_CHARS
        else:
            cap = MAX_READ_CHARS

        with open(safe_path, "r", encoding="utf-8", errors="replace") as f:
            if start_line > 1:
                for _ in range(start_line - 1):
                    if not f.readline():
                        break
            content = f.read(cap + 1)

        if len(content) > cap:
            next_offset = start_line + content[:cap].count("\n") + 1
            content = content[:cap] + \
                f"\n\n[truncated at {cap} chars; re-call with offset={next_offset} to continue]"
        return content

    def write_file(self, file_path, content):
        """Write UTF-8 text to a file in the sandbox. Parent folders are created
        automatically; existing files are overwritten (use edit_file to patch).

        Args:
            file_path: Path relative to the sandbox.
            content: Text content to write.
        """
        safe_path = self.validate_path(file_path)
        if content is None:
            content = ""
        if len(content) > MAX_WRITE_CHARS:
            raise ValueError(
                f"Content too large ({len(content):,} > {MAX_WRITE_CHARS:,} chars)."
            )
        os.makedirs(os.path.dirname(safe_path), exist_ok=True)
        with open(safe_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Wrote {len(content):,} chars to {file_path}"

    def edit_file(self, file_path, old_string, new_string):
        """Replace exact literal string occurrences in a file (not a regex).
        All occurrences are replaced and the count is reported.

        Args:
            file_path: Path relative to the sandbox.
            old_string: Exact text to find.
            new_string: Replacement text.
        """
        safe_path = self.validate_path(file_path)
        with open(safe_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if old_string not in content:
            raise ValueError(f"String not found in file: {old_string[:80]!r}...")

        count = content.count(old_string)
        with open(safe_path, "w", encoding="utf-8") as f:
            f.write(content.replace(old_string, new_string))

        prev = old_string[:60] + "..." if len(old_string) > 60 else old_string
        newv = new_string[:60] + "..." if len(new_string) > 60 else new_string
        return f"Replaced {count} occurrence(s) of {prev!r} with {newv!r} in {file_path}"

    def list_sandbox_files(self, pattern: str = "*") -> str:
        """List files in the sandbox with sizes, one per line. Optionally filter
        with a glob pattern, e.g. '*.csv'. Use search_files for fuzzy/recursive
        pattern hunting."""
        out = []
        for root, dirs, files in os.walk(ALLOWED_DIR):
            dirs[:] = [d for d in dirs if d not in self._SKIP_DIRS]
            for name in files:
                rel = os.path.relpath(os.path.join(root, name), ALLOWED_DIR)
                if pattern and pattern != "*" and not fnmatch.fnmatch(rel, pattern):
                    continue
                try:
                    out.append(f"{rel} ({os.path.getsize(os.path.join(root, name)):,} B)")
                except OSError:
                    out.append(rel)
        if not out:
            return "(sandbox is empty)"
        return "\n".join(sorted(out)[:500])

    def search_files(self, pattern: str) -> str:
        """Find files AND folders in the sandbox by glob pattern (relative paths).
        Examples: '*.csv', 'data/*.json', 'report*'. Use this before read_file
        when you are not sure of the exact filename.

        Args:
            pattern: Glob pattern matched against relative paths and basenames.
        """
        if not pattern or not pattern.strip():
            return "No pattern given."

        out = []
        for root, dirs, files in os.walk(ALLOWED_DIR):
            dirs[:] = [d for d in dirs if d not in self._SKIP_DIRS]
            for name in dirs + files:
                rel = os.path.relpath(os.path.join(root, name), ALLOWED_DIR)
                if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(name, pattern):
                    out.append(rel + ("/" if name in dirs else ""))
                    if len(out) >= 200:
                        out.append("[result list capped at 200]")
                        return "\n".join(out)
        return "\n".join(out) if out else f"No matches for pattern: {pattern}"

    def grep(self, needle: str, glob_pattern: str = "*", max_results: int = 100) -> str:
        """Search the CONTENT of sandbox text files for a substring or regex.
        Returns 'file:line: text' hits (capped). Use search_files to find files
        by name instead.

        Args:
            needle: Substring or regular expression to search for.
            glob_pattern: Only search files whose NAME matches this glob (e.g. '*.py').
            max_results: Max hits to return.
        """
        if not needle:
            return "Empty search string."
        try:
            rx = re.compile(needle, re.IGNORECASE)
        except re.error:
            rx = re.compile(re.escape(needle), re.IGNORECASE)

        hits = []
        for root, dirs, files in os.walk(ALLOWED_DIR):
            dirs[:] = [d for d in dirs if d not in self._SKIP_DIRS]
            for name in files:
                if not fnmatch.fnmatch(name, glob_pattern):
                    continue
                p = os.path.join(root, name)
                try:
                    if os.path.getsize(p) > 5_000_000:
                        continue
                    with open(p, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f, 1):
                            if rx.search(line):
                                hits.append(
                                    f"{os.path.relpath(p, ALLOWED_DIR)}:{i}: {line.strip()[:200]}"
                                )
                                if len(hits) >= max(1, int(max_results)):
                                    hits.append("[capped]")
                                    return "\n".join(hits)
                except (OSError, UnicodeError):
                    continue
        return "\n".join(hits) if hits else f"No matches for: {needle}"

    def delete_file(self, file_path):
        """Delete a file or folder from the sandbox. Refuses to delete the
        sandbox root itself.

        Args:
            file_path: Path relative to the sandbox.
        """
        safe_path = self.validate_path(file_path)
        if os.path.realpath(safe_path) == os.path.realpath(ALLOWED_DIR):
            return "Refusing to delete the sandbox root. Delete specific files/folders instead."
        if not os.path.exists(safe_path):
            return f"File not found: {file_path}"
        try:
            if os.path.isdir(safe_path):
                shutil.rmtree(safe_path)
            else:
                os.remove(safe_path)
            return f"Deleted: {file_path}"
        except Exception as e:
            return f"Error deleting {file_path}: {e}"

    def create_folder(self, folder_path):
        """Create a folder (and any missing parents) in the sandbox directory.

        Args:
            folder_path: Path relative to the sandbox.
        """
        safe_path = self.validate_path(folder_path)
        try:
            os.makedirs(safe_path, exist_ok=True)
            return f"Created folder: {folder_path}"
        except Exception as e:
            return f"Error creating folder {folder_path}: {e}"

    def _unique_dst(self, dst_path: str) -> str:
        """dst.txt -> dst_1.txt -> dst_2.txt ... to avoid silent overwrites."""
        if not os.path.exists(dst_path):
            return dst_path
        base, ext = os.path.splitext(dst_path)
        n = 1
        while os.path.exists(f"{base}_{n}{ext}"):
            n += 1
        return f"{base}_{n}{ext}"

    def move_files(self, paths, target):
        """Move files or folders to a target directory within the sandbox.
        Existing files at the destination are NOT overwritten - the moved item
        is renamed (name_1.ext, name_2.ext, ...).

        Args:
            paths: List of sandbox paths to move.
            target: Destination folder inside the sandbox.
        """
        safe_target = self.validate_path(target)
        if not os.path.exists(safe_target):
            os.makedirs(safe_target, exist_ok=True)
        elif not os.path.isdir(safe_target):
            return f"Target is not a directory: {target}"

        results = []
        for path in paths:
            try:
                safe_src = self.validate_path(path)
            except ValueError as e:
                results.append(f"Blocked: {path} ({e})")
                continue
            if not os.path.exists(safe_src):
                results.append(f"Source not found: {path}")
                continue
            dst_path = self._unique_dst(os.path.join(safe_target, os.path.basename(safe_src)))
            try:
                shutil.move(safe_src, dst_path)
                results.append(f"Moved {path} -> {target}/{os.path.basename(dst_path)}")
            except Exception as e:
                results.append(f"Error moving {path}: {e}")
        return "\n".join(results)

    def copy_files(self, paths, target):
        """Copy files or folders to a target directory within the sandbox.
        Existing files at the destination are NOT overwritten - the copy is
        renamed (name_1.ext, name_2.ext, ...).

        Args:
            paths: List of sandbox paths to copy.
            target: Destination folder inside the sandbox.
        """
        safe_target = self.validate_path(target)
        if not os.path.exists(safe_target):
            os.makedirs(safe_target, exist_ok=True)
        elif not os.path.isdir(safe_target):
            return f"Target is not a directory: {target}"

        results = []
        for path in paths:
            try:
                safe_src = self.validate_path(path)
            except ValueError as e:
                results.append(f"Blocked: {path} ({e})")
                continue
            if not os.path.exists(safe_src):
                results.append(f"Source not found: {path}")
                continue
            dst_path = self._unique_dst(os.path.join(safe_target, os.path.basename(safe_src)))
            try:
                if os.path.isdir(safe_src):
                    shutil.copytree(safe_src, dst_path, dirs_exist_ok=True)
                else:
                    shutil.copy2(safe_src, dst_path)
                results.append(f"Copied {path} -> {target}/{os.path.basename(dst_path)}")
            except Exception as e:
                results.append(f"Error copying {path}: {e}")
        return "\n".join(results)

    # ------------------------------------------------------------------ misc

    def get_time(self) -> str:
        """Current local date/time, timezone and weekday. Always call this before
        using dates in filenames, reports, or answering 'today/now' questions."""
        return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z (%A)")


# --------------------------------------------------------------------------------------
# Function-calling schema generation (OpenAI format)
# --------------------------------------------------------------------------------------
# Tools exposed to the LLM by default. run_command is powerful - many hosts launch
# with exclude=["run_command"] and enable it once they trust the agent's behaviour.
DEFAULT_TOOLS = [
    "web_search", "scrape", "http_request",
    "read_file", "write_file", "edit_file",
    "list_sandbox_files", "search_files", "grep",
    "delete_file", "create_folder", "move_files", "copy_files",
    "get_time", "run_command",
]

# Refinements that type hints/docstrings alone cannot express (enums, array item
# types, explicit types for params the introspector would guess wrong).
TOOL_PARAM_OVERRIDES = {
    "read_file": {
        "length": {"type": "integer", "description": "Max characters to return"},
    },
    "move_files": {"paths": {"type": "array", "items": {"type": "string"}}},
    "copy_files": {"paths": {"type": "array", "items": {"type": "string"}}},
    "http_request": {
        "method": {"type": "string",
                   "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]},
    },
}

_JSON_TYPES = {str: "string", int: "integer", float: "number", bool: "boolean",
               list: "array", dict: "object", tuple: "array"}

_SECTION_RE = re.compile(r"^[A-Z][A-Za-z ]*:$")   # "Args:", "Returns:", "Safeguards:" ...
_PARAM_RE = re.compile(r"^(\w+)\s*:\s*(.*)$")


def _parse_docstring(doc: str):
    """Extract (summary, {param_name: description}) from a Google-style docstring.
    Wrapped continuation lines inside 'Args:' are folded into the parameter above."""
    if not doc:
        return "", {}
    lines = inspect.cleandoc(doc).splitlines()

    summary_parts = []
    for ln in lines:
        if not ln.strip():
            break
        summary_parts.append(ln.strip())
    summary = " ".join(summary_parts)

    params = {}
    in_args = False
    current = None
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if _SECTION_RE.match(stripped):
            in_args = stripped.lower() == "args:"
            current = None
            continue
        if in_args:
            m = _PARAM_RE.match(stripped)
            if m:
                current = m.group(1)
                params[current] = m.group(2).strip()
            elif current:
                params[current] += " " + stripped  # wrapped continuation line
    return summary, params


def _json_type(annotation, default) -> str:
    """Map a Python annotation (or failing that, the default value) to a JSON type."""
    if annotation is not inspect.Parameter.empty:
        origin = get_origin(annotation)
        if origin is Union or (hasattr(types, "UnionType") and origin is types.UnionType):
            args = [a for a in get_args(annotation) if a is not type(None)]
            if args:
                return _json_type(args[0], default)   # unwrap Optional[X] / X | None
        if annotation in _JSON_TYPES:
            return _JSON_TYPES[annotation]
    elif default is not inspect.Parameter.empty and default is not None:
        return _JSON_TYPES.get(type(default), "string")
    return "string"


def _build_function_schema(name: str, func, overrides=None) -> dict:
    """Build one OpenAI function-calling schema from a bound method."""
    doc = inspect.getdoc(func) or ""
    summary, param_docs = _parse_docstring(doc)
    sig = inspect.signature(func)

    properties = {}
    required = []
    for pname, p in sig.parameters.items():
        if pname == "self" or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        sch = {"type": _json_type(p.annotation, p.default)}
        desc = param_docs.get(pname, "")
        if desc:
            sch["description"] = desc
        if overrides and pname in overrides:
            sch.update(overrides[pname])   # may add enum/items/correct the type
        properties[pname] = sch
        if p.default is inspect.Parameter.empty:
            required.append(pname)

    return {
        "type": "function",
        "function": {
            "name": name,
            "description": summary[:800],
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


def _resolve_tool_methods(obj, include=None, exclude=None):
    """Return sorted [(name, callable)] for the selected tool names.
    Raises ValueError for names that don't exist on obj (catches typos early)."""
    requested = set(include if include is not None else DEFAULT_TOOLS)
    requested -= set(exclude or [])

    methods = []
    missing = []
    for name in sorted(requested):
        func = getattr(obj, name, None)
        if func is None or not callable(func):
            missing.append(name)
            continue
        methods.append((name, func))
    if missing:
        raise ValueError(f"Unknown tool name(s): {', '.join(sorted(missing))}")
    return methods


def get_tool_schemas(obj, include=None, exclude=None) -> list:
    """Generate OpenAI function-calling tool schemas from a Tools instance.

    Tool descriptions come from each method's docstring summary, parameter
    descriptions from the Google-style 'Args:' sections, and JSON types from
    type hints (refined by TOOL_PARAM_OVERRIDES). This keeps your schemas from
    drifting out of sync with the implementation.

    Args:
        obj: Your Tools instance (e.g. agent_tools = Tools()).
        include: Optional list of tool names to expose (default: DEFAULT_TOOLS).
        exclude: Optional tool names to hide, e.g. ["run_command"].

    Returns:
        List of {"type": "function", "function": {...}} dicts, sorted by name.
    """
    return [
        _build_function_schema(name, func, TOOL_PARAM_OVERRIDES.get(name))
        for name, func in _resolve_tool_methods(obj, include, exclude)
    ]


def build_tool_registry(obj, include=None, exclude=None) -> dict:
    """Map tool name -> bound method, using the same selection rules as
    get_tool_schemas, so the registry can never drift from the schemas."""
    return dict(_resolve_tool_methods(obj, include, exclude))


def build_tools(obj, include=None, exclude=None):
    """One-call setup for function-calling hosts: returns (registry, schemas),
    guaranteed consistent with each other.

    Example:
        agent_tools = Tools()
        TOOL_REGISTRY, TOOLS_SCHEMA = build_tools(agent_tools, exclude=["run_command"])
    """
    methods = _resolve_tool_methods(obj, include, exclude)
    registry = {name: func for name, func in methods}
    schemas = [
        _build_function_schema(name, func, TOOL_PARAM_OVERRIDES.get(name))
        for name, func in methods
    ]
    return registry, schemas
