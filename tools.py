import httpx
import os
from ddgs import DDGS
import asyncio
import os
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from langchain_core.tools import tool

class Tools:
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

    class ScrapeRequest(BaseModel):
        url: str
    @tool
    async def we_search(self, url: ScrapeRequest):
        """Search the web for real-time information."""
        return await self.scrape_with_jina(url)