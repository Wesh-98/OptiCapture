import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      status: 401,
      json: { error: 'Unauthenticated' },
    });
  });

  await page.route('**/api/auth/my-stores', async route => {
    await route.fulfill({ json: [] });
  });
});

test('redirects protected routes to the login screen', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Store Code')).toBeVisible();
});

test('validates store code before submitting normal logins', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByText('Store Code Required')).toBeVisible();
});

test('renders mobile scan and submits a manual scan through the browser', async ({ page }) => {
  await page.route('**/api/session/session-1/items?*', async route => {
    await route.fulfill({
      json: {
        status: 'active',
        items: [
          {
            id: 1,
            product_name: 'Existing Cola',
            upc: '111222333444',
            unit: 'can',
            quantity: 2,
            scanned_at: '2026-01-02T10:00:00Z',
          },
        ],
      },
    });
  });

  await page.route('**/api/session/session-1/scan', async route => {
    expect(route.request().postDataJSON()).toMatchObject({
      upc: '222333444555',
      otp: 'otp-1',
      item_name: 'Manual Seltzer',
    });

    await route.fulfill({
      json: {
        item: {
          id: 2,
          product_name: 'Manual Seltzer',
          upc: '222333444555',
          unit: 'bottle',
          quantity: 1,
          scanned_at: '2026-01-02T10:01:00Z',
        },
      },
    });
  });

  await page.goto('/mobile-scan/session-1?otp=otp-1');

  await expect(page.getByText('Existing Cola')).toBeVisible();
  await expect(page.getByText('UPC 111222333444')).toBeVisible();

  await page.getByRole('button', { name: 'Manual' }).click();
  await page.getByPlaceholder('Item name (optional)').fill('Manual Seltzer');
  await page.getByPlaceholder('UPC / Barcode *').fill('222333444555');
  await page.getByRole('button', { name: 'Add Item' }).click();

  await expect(page.getByText('Manual Seltzer').first()).toBeVisible();
  await expect(page.getByText('UPC 222333444555')).toBeVisible();
  await expect(page.getByText('bottle')).toBeVisible();
});

test('opens category inventory even after filtering the category list', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      json: {
        id: 1,
        username: 'admin',
        role: 'owner',
        store_id: 1,
        store_name: 'OptiMart Central Downtown',
        store_logo: null,
        must_reset_password: false,
        needs_store_selection: false,
      },
    });
  });

  await page.route('**/api/auth/my-stores', async route => {
    await route.fulfill({
      json: [
        {
          id: 1,
          name: 'OptiMart Central Downtown',
          logo: null,
          status: 'active',
          role: 'owner',
        },
      ],
    });
  });

  await page.route('**/api/dashboard/stats', async route => {
    await route.fulfill({
      json: {
        totalCategories: 1,
        totalItems: 486,
        inStock: 486,
        outOfStock: 0,
      },
    });
  });

  await page.route('**/api/sessions/active', async route => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/api/categories', async route => {
    await route.fulfill({
      json: [
        {
          id: 2,
          name: 'Snacks',
          status: 'Active',
          icon: 'Package',
          store_id: 1,
          item_count: 486,
          total_stock: 24300,
        },
      ],
    });
  });

  await page.route('**/api/inventory?*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('category_id') !== '2') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      json: {
        items: [
          {
            id: 99,
            item_name: 'Pretzel Rods',
            quantity: 12,
            unit: 'bag',
            category_id: 2,
            category_name: 'Snacks',
            status: 'Active',
            sale_price: 3.49,
            upc: '999111222333',
            image: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
  });

  await page.goto('/');

  await page.getByPlaceholder('Search categories...').fill('Snacks');
  await page.getByTitle('View Snacks items').click();

  await expect(page.getByRole('heading', { name: 'Snacks Items' })).toBeVisible();
  await expect(page.getByPlaceholder('Search items...')).toHaveValue('');
  await expect(page.getByText('Pretzel Rods')).toBeVisible();
  await expect(page.getByText('999111222333')).toBeVisible();
});

test('opens the all-items inventory table from the category dashboard', async ({ page }) => {
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      json: {
        id: 1,
        username: 'admin',
        role: 'owner',
        store_id: 1,
        store_name: 'OptiMart Central Downtown',
        store_logo: null,
        must_reset_password: false,
        needs_store_selection: false,
      },
    });
  });

  await page.route('**/api/auth/my-stores', async route => {
    await route.fulfill({
      json: [
        {
          id: 1,
          name: 'OptiMart Central Downtown',
          logo: null,
          status: 'active',
          role: 'owner',
        },
      ],
    });
  });

  await page.route('**/api/dashboard/stats', async route => {
    await route.fulfill({
      json: {
        totalCategories: 1,
        totalItems: 2982,
        inStock: 2982,
        outOfStock: 0,
      },
    });
  });

  await page.route('**/api/sessions/active', async route => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/api/categories', async route => {
    await route.fulfill({
      json: [
        {
          id: 2,
          name: 'Snacks',
          status: 'Active',
          icon: 'Package',
          store_id: 1,
          item_count: 486,
          total_stock: 24300,
        },
      ],
    });
  });

  await page.route('**/api/inventory?*', async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('category_id')).toBeNull();

    await route.fulfill({
      json: {
        items: [
          {
            id: 101,
            item_name: 'Cola Bottle',
            quantity: 24,
            unit: 'bottle',
            category_id: 1,
            category_name: 'Soft Drinks',
            status: 'Active',
            sale_price: 2.49,
            upc: '111000222333',
            image: null,
          },
        ],
        total: 2982,
        page: 1,
        limit: 50,
      },
    });
  });

  await page.goto('/');

  await page.getByRole('button', { name: 'View All Items' }).click();

  await expect(page.getByRole('heading', { name: 'All Items' })).toBeVisible();
  await expect(page.getByText('Cola Bottle')).toBeVisible();
  await expect(page.getByText('111000222333')).toBeVisible();
});
