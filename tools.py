import httpx
import os
from ddgs import DDGS
import asyncio
import re
from fastapi.responses import JSONResponse
import urllib.parse

ALLOWED_DIR = f"{os.getcwd()}\\sandbox"


class Tools:
    def validate_url(self, url: str) -> str:
        """
        Return the URL unchanged if it uses an allowed scheme (http or https).
        Raise ValueError for any other scheme (file:, ftp:, etc.).
        """
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme.lower()

        if scheme not in ("http", "https"):
            raise ValueError(
                f"Access denied: URL scheme '{scheme}' is not allowed. "
                "Only http(s) URLs are permitted."
            )

        # Return a normalised representation (lower‑case scheme, keep rest as‑is)
        return urllib.parse.urlunparse((
            scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            parsed.query,
            parsed.fragment
        ))

    def _get_crawler_args(self):
        """Return crawler config that avoids headless-browser detection (e.g. Cloudflare JS challenge)."""
        profile_dir = os.path.join(os.path.expanduser("~"), ".cache", "crawl4ai_profile")
        os.makedirs(profile_dir, exist_ok=True)
        return {
            "verbose": False,
            "headless": True,
            "browser_args": [
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
            ],
            "user_data_dir": profile_dir,  # persistent profile = realistic fingerprint + cookies
        }
    def run_jina_sync(self, url: str):
        """Fetch page content via Jina Reader. Used when the direct crawler is blocked by anti-bot (Cloudflare) protection."""
        jina_url = "https://r.jina.ai/" + url
        try:
            with httpx.Client(timeout=40, follow_redirects=True) as client:
                resp = client.get(jina_url, headers={
                    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) "
                                "Chrome/131.0.0.0 Safari/537.36")
                })
                return resp.text if resp.status_code == 200 else None
        except Exception as e:
            print(f"Jina reader failed for {url}: {e}")
            return None
    def run_crawl_sync(self, url: str):
        """Crawl a URL with Crawl4AI using a persistent profile and stealth args; returns markdown or falls back to Jina Reader."""
        async def _crawl():
            from crawl4ai import AsyncWebCrawler
            attempts = 0
            while attempts < 3:
                attempts += 1
                try:
                    async with AsyncWebCrawler(**self._get_crawler_args()) as crawler:
                        result = await crawler.arun(url=url, word_count=500)
                        if result and result.markdown and len(result.markdown.strip()) > 100:
                            return result.markdown
                except Exception as e:
                    print(f"Crawl attempt {attempts} failed for {url}: {e}")
            return None

        markdown = asyncio.run(_crawl())
        if markdown:
            return markdown
        # Fallback: Jina Reader (often bypasses Cloudflare bot protection)
        return self.run_jina_sync(url)
    def run_crawl_multi_sync(self, links: list):
        """Crawl multiple links, falling back to Jina Reader when the direct crawler fails."""
        async def _crawl():
            from crawl4ai import AsyncWebCrawler
            res = []
            async with AsyncWebCrawler(**self._get_crawler_args()) as crawler:
                for link in links:
                    try:
                        result = await crawler.arun(url=link, word_count=300)
                        markdown = result.markdown if (result and result.markdown) else None
                        if not markdown:
                            markdown = self.run_jina_sync(link)
                        res.append((link, markdown, None if markdown else "Failed to scrape"))
                    except Exception as e:
                        err_msg = str(e)
                        md = self.run_jina_sync(link)
                        res.append((link, md, err_msg if not md else None))
            return res
        return asyncio.run(_crawl()) 
    async def scrape_with_jina(self, req):
        """
        Scrapes a webpage using Jina Reader.
        
        Args:
            req.url (str): The URL of the webpage to scrape.
        """
        target = req.url
        
        # Check if it looks like a URL
        is_url = target.startswith("http://") or target.startswith("https://") or ("." in target and " " not in target)
        target_url = target
        if is_url and not target.startswith("http"):
            target_url = "https://" + target
        
        markdown_content = None
        loop = asyncio.get_running_loop()
        if is_url:
            try:
                markdown_content = await loop.run_in_executor(None, self.run_crawl_sync, target_url)
            except Exception as e:
                print(f"Direct crawl failed: {e}")

        if markdown_content:
            return JSONResponse(content={"content": markdown_content})

        # Fallback 1: Jina Reader directly (bypasses Cloudflare / anti-bot blocks)
        if is_url:
            try:
                jina_content = await loop.run_in_executor(None, self.run_jina_sync, target_url)
                if jina_content:
                    return JSONResponse(content={"content": jina_content})
            except Exception as e:
                print(f"Jina fallback failed for {target_url}: {e}")

        # Fallback 2: search engine results -> crawl the top links
        links = []
        try:
            with DDGS(timeout=20) as ddgs:
                results = ddgs.text(target, max_results=2, backend="lite")
                for r in results:
                    links.append(r.get("href"))
        except Exception as e:
            return JSONResponse(content={"error": f"DDGS failed: {e}", "content": None}, status_code=500)

        if not links:
            return JSONResponse(content={"error": "No results found on DDGS", "content": None}, status_code=404)

        # Crawl the links
        combined_markdown = f"# Search Results for: {target}\n\n"
        try:
            results = await loop.run_in_executor(None, self.run_crawl_multi_sync, links)
            for i, (link, md, err) in enumerate(results):
                if md:
                    combined_markdown += f"## Source {i+1}: {link}\n\n{md}\n\n---\n\n"
                else:
                    combined_markdown += f"## Source {i+1}: {link}\n\nFailed to scrape: {err}\n\n---\n\n"
        except Exception as e:
            return JSONResponse(content={"error": f"Crawler failed on links: {e}", "content": None}, status_code=500)

        return JSONResponse(content={"content": combined_markdown})

    async def scrape(self, url: str) -> str:
        """Fetch the full content of a specific webpage as markdown.

        Args:
            url: The URL of the page to fetch.
        """
        
        loop = asyncio.get_running_loop()
        self.validate_url(url)
        target_url = url if url.startswith("http") else "https://" + url
        md = await loop.run_in_executor(None, self.run_crawl_sync, target_url)
        if not md:
            md = await loop.run_in_executor(None, self.run_jina_sync, target_url)
        return md or f"Could not retrieve content from {target_url}"

    async def web_search(self, query: str, max_results: int = 3) -> str:
        """Search the web for real-time information. Use for anything recent, factual, or uncertain.

        Args:
            query: The search query or topic to look up.
            max_results: Number of top results to fetch content from.
        """
        loop = asyncio.get_running_loop()

        # If the "query" is actually a URL, scrape it directly
        is_url = query.startswith("http://") or query.startswith("https://") or ("." in query and " " not in query)
        if is_url:
            self.validate_url(query)
            target_url = query if query.startswith("http") else "https://" + query
            md = await loop.run_in_executor(None, self.run_crawl_sync, target_url)
            if not md:
                md = await loop.run_in_executor(None, self.run_jina_sync, target_url)
            return md or f"Could not retrieve content from {target_url}"

        # Otherwise treat it as a search query
        def _search():
            with DDGS(timeout=20) as ddgs:
                return list(ddgs.text(query, max_results=max_results, backend="lite"))

        try:
            results = await loop.run_in_executor(None, _search)
            links = [r.get("href") for r in results if r.get("href")]
        except Exception as e:
            return f"Search failed: {e}"

        if not links:
            return "No search results found."

        combined = f"# Search results for: {query}\n\n"
        try:
            crawled = await loop.run_in_executor(None, self.run_crawl_multi_sync, links)
            for i, (link, md, err) in enumerate(crawled):
                combined += f"## Source {i+1}: {link}\n\n"
                combined += ((md[:4000] if md else f"Failed to scrape: {err}")) + "\n\n---\n\n"
        except Exception as e:
            return f"Search succeeded but crawling failed: {e}"

        return combined

    

    def validate_path(self, file_path):
        abs_path = os.path.abspath(os.path.join(ALLOWED_DIR, file_path))
        if not abs_path.startswith(os.path.abspath(ALLOWED_DIR) + os.sep):
            raise ValueError("Access denied: path escapes the allowed directory")
        return abs_path

    def read_file(self, file_path, offset=0, length=None):
        safe_path = self.validate_path(file_path)
        with open(safe_path, 'r') as f:
            f.seek(offset)
            if length is not None:
                return f.read(length)
            return f.read()

    def write_file(self, file_path, content):
        safe_path = self.validate_path(file_path)
        with open(safe_path, 'w') as f:
            f.write(content)

    def edit_file(self, file_path, pattern, replacement, flags=0):
        safe_path = self.validate_path(file_path)
        with open(safe_path, 'r') as f:
            content = f.read()
        new_content = re.sub(pattern, replacement, content, flags=flags)
        with open(safe_path, 'w') as f:
            f.write(new_content)
    
    def list_sandbox_files(self):
        file_list = []
        for root, dirs, files in os.walk(ALLOWED_DIR):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(self.validate_path(full_path), ALLOWED_DIR)
                file_list.append(rel_path)
        
        return ", ".join(file_list)