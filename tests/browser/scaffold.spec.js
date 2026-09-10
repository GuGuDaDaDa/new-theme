/** Browser checks for the runnable scaffold, not the final theme interactions. */
import { test, expect } from '@playwright/test';

test('home renders compiled CSS and JavaScript and links to a readable post', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-js', 'ready');
  await expect(page.locator('h1')).toHaveText('最新文章');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(247, 248, 250)',
  );
  await page.locator('.post h2 a').first().click();
  await expect(page.locator('.prose')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('mobile and no-JS basic browsing remain available', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.masonry')).toHaveCSS(
    'grid-template-columns',
    '350px',
  );
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '关于' })
    .click();
  await expect(page.locator('h1')).toHaveText('关于');
  await context.close();
});
