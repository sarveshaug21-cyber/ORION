/**
 * ORION Browser Tools
 * Tools for web browsing and content extraction
 */

import type { ToolResult } from '../../types/index.js';
import { createTool } from '../registry.js';

export const browserOpen = createTool({
  name: 'browser.open',
  description: 'Open a URL and extract content (text, markdown, or structured data)',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open' },
      format: { type: 'string', enum: ['text', 'markdown', 'html', 'json'], description: 'Output format', default: 'markdown' },
      waitFor: { type: 'number', description: 'Wait milliseconds for dynamic content', default: 0 },
      extractSchema: { type: 'object', description: 'JSON schema for structured extraction (when format is json)' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args, _context): Promise<ToolResult> {
    const { url, format = 'markdown', waitFor = 0 } = args;

    try {
      if (format === 'json') {
        return { success: false, error: 'Structured JSON extraction is not configured.' };
      }
      if (typeof waitFor === 'number' && waitFor > 0) {
        return { success: false, error: 'Waiting for dynamic page content is not supported by the current browser tool.' };
      }

      // Validate URL
      const parsedUrl = new URL(url as string);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Only HTTP/HTTPS URLs are allowed' };
      }

      // In a real implementation, this would use a headless browser (Puppeteer/Playwright)
      // or a service like Firecrawl. For now, we'll use a simple fetch with basic extraction.
      
      const response = await fetch(url as string, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ORION/0.1; +https://orion.ai)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const html = await response.text();
      
      let content: string;
      if (format === 'html') {
        content = html;
      } else if (format === 'text') {
        // Simple text extraction
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } else if (format === 'markdown') {
        // Basic HTML to markdown conversion
        content = html
          .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
          .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
          .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
          .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
          .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
          .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } else {
        content = html;
      }

      return {
        success: true,
        data: {
          url,
          format,
          content: content.slice(0, 100000), // Limit to 100KB
          title: extractTitle(html),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open URL',
      };
    }
  },
});

export const browserSearch = createTool({
  name: 'browser.search',
  description: 'Search the web and return results',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      maxResults: { type: 'number', description: 'Maximum results to return', default: 10 },
      engine: { type: 'string', enum: ['google', 'duckduckgo', 'bing'], description: 'Search engine', default: 'duckduckgo' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(_args, _context): Promise<ToolResult> {
    return {
      success: false,
      error: 'Web search is not configured. Configure a search provider before using this tool.',
    };
  },
});

export const browserScreenshot = createTool({
  name: 'browser.screenshot',
  description: 'Take a screenshot of a webpage',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to screenshot' },
      fullPage: { type: 'boolean', description: 'Capture full page', default: false },
      width: { type: 'number', description: 'Viewport width', default: 1280 },
      height: { type: 'number', description: 'Viewport height', default: 720 },
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format', default: 'png' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args, _context): Promise<ToolResult> {
    const { url } = args;

    return {
      success: false,
      error: 'Screenshot requires headless browser integration (Puppeteer/Playwright)',
      data: { url, note: 'Feature not yet implemented' },
    };
  },
});

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : 'Untitled';
}

// Export all browser tools
export const browserTools = [
  browserOpen,
  browserSearch,
  browserScreenshot,
];