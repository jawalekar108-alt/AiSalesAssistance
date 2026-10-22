18/10

//21/9


/* ============================================================
   AI SALES BOT - CATALOG DASHBOARD
   Instagram Product Catalog + Manual Products
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Helpers
  ------------------------------------------------------------ */

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') {
      return '₹—';
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
      return `₹${escapeHtml(value)}`;
    }

    return `₹${number.toLocaleString('en-IN')}`;
  }

  function formatStock(stock) {
    if (stock === null || stock === undefined || stock === '') {
      return 'Not specified';
    }

    const number = Number(stock);

    if (Number.isNaN(number)) {
      return escapeHtml(stock);
    }

    if (number <= 0) {
      return 'Out of stock';
    }

    return `${number} in stock`;
  }

  function getSourceBadge(product) {
    const isInstagram =
      product.source === 'instagram' ||
      product.instagram_media_id ||
      product.instagram_account_id ||
      product.instagram_url;

    if (isInstagram) {
      return `
        <span style="
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 8px;
          border-radius:999px;
          background:rgba(225,48,108,0.14);
          border:1px solid rgba(225,48,108,0.25);
          color:#f472b6;
          font-size:0.68rem;
          font-weight:700;
        ">
          <i class="fab fa-instagram"></i>
          INSTAGRAM
        </span>
      `;
    }

    return `
      <span style="
        display:inline-flex;
        align-items:center;
        padding:4px 8px;
        border-radius:999px;
        background:rgba(255,255,255,0.06);
        color:#94a3b8;
        font-size:0.68rem;
        font-weight:600;
      ">
        MANUAL
      </span>
    `;
  }

  // Products currently shown in the table (used by Edit / Delete)
  let lastProducts = [];

  function catalogStoreId() {
    const filter = document.getElementById('catalog-store-filter');
    return filter && filter.value ? filter.value : 'clothing';
  }

  function isInstagramProduct(product) {
    return (
      product &&
      (
        product.source === 'instagram' ||
        product.instagram_media_id ||
        product.instagram_account_id ||
        product.instagram_url
      )
    );
  }

  /* ------------------------------------------------------------
     Load Catalog
  ------------------------------------------------------------ */

  async function loadCatalogView() {
    const filter = document.getElementById('catalog-store-filter');

    const storeType = filter
      ? filter.value
      : 'clothing';

    try {
      setCatalogStatus('Loading catalog...', 'loading');

      const res = await fetch(
        `/api/catalog/products?store_type=${encodeURIComponent(storeType)}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: { 'x-store-id': storeType }
        }
      );

      if (!res.ok) {
        throw new Error(`Catalog API returned ${res.status}`);
      }

      const data = await res.json();

      if (data.success) {
        lastProducts = data.products || [];
        renderCatalogTable(data.products || [], storeType);

        setCatalogStatus(
          `${(data.products || []).length} product(s) loaded`,
          'success'
        );
      } else {
        throw new Error(data.message || 'Failed to load catalog');
      }

    } catch (err) {
      console.error('Failed to load catalog:', err);

      setCatalogStatus(
        'Failed to load catalog',
        'error'
      );

      const tbody = document.getElementById('catalog-table-body');

      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="
              text-align:center;
              padding:30px;
              color:#f87171;
            ">
              Failed to load catalog.
              <br>
              <small style="color:#94a3b8;">
                ${escapeHtml(err.message)}
              </small>
            </td>
          </tr>
        `;
      }
    }
  }

  /* ------------------------------------------------------------
     Filter
  ------------------------------------------------------------ */

  function filterCatalog() {
    loadCatalogView();
  }

  /* ------------------------------------------------------------
     Render Catalog
  ------------------------------------------------------------ */

  function renderCatalogTable(products, storeType) {
    const tbody = document.getElementById('catalog-table-body');

    if (!tbody) {
      console.error('catalog-table-body not found');
      return;
    }

    if (!products || products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="
            text-align:center;
            padding:40px 20px;
            color:#888;
          ">
            <div style="font-size:2rem;margin-bottom:10px;">
              📦
            </div>

            <strong>No products found</strong>

            <div style="
              margin-top:8px;
              font-size:0.8rem;
              color:#64748b;
            ">
              Click "Sync Instagram" to import products from your Instagram account.
            </div>
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML = products.map((p) => {

      /* --------------------------------------------------------
         Product details
      -------------------------------------------------------- */

      let detailsHtml = '';

      if (p.store_type !== 'electronics') {

        const sizes = Array.isArray(p.sizes)
          ? p.sizes.join(', ')
          : (p.sizes || 'Not specified');

        const colors = Array.isArray(p.colors)
          ? p.colors.join(', ')
          : (p.colors || 'Not specified');

        detailsHtml = `
          <div style="
            font-size:0.72rem;
            color:#94a3b8;
            line-height:1.6;
          ">
            <div>
              <strong>Sizes:</strong>
              ${escapeHtml(sizes)}
            </div>

            <div>
              <strong>Colors:</strong>
              ${escapeHtml(colors)}
            </div>

            ${
              p.fabric
                ? `
                  <div>
                    <strong>Fabric:</strong>
                    ${escapeHtml(p.fabric)}
                  </div>
                `
                : ''
            }

            ${
              p.fit_type
                ? `
                  <div>
                    <strong>Fit:</strong>
                    ${escapeHtml(p.fit_type)}
                  </div>
                `
                : ''
            }
          </div>
        `;

      } else {

        const specsSummary =
          p.specs && typeof p.specs === 'object'
            ? Object.entries(p.specs)
                .slice(0, 3)
                .map(
                  ([k, v]) =>
                    `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}`
                )
                .join('<br>')
            : 'Standard Tech Specs';

        detailsHtml = `
          <div style="
            font-size:0.72rem;
            color:#94a3b8;
            line-height:1.6;
          ">
            ${specsSummary}
          </div>
        `;
      }

      /* --------------------------------------------------------
         Instagram information
      -------------------------------------------------------- */

      const instagramProduct = isInstagramProduct(p);

      const instagramLink =
        p.instagram_url ||
        p.permalink ||
        '';

      const caption =
        p.caption ||
        '';

      const captionPreview =
        caption.length > 180
          ? `${caption.substring(0, 180)}...`
          : caption;

      const sourceHtml = getSourceBadge(p);

      const imageUrl =
        p.image_url ||
        p.media_url ||
        p.thumbnail_url ||
        '';

      const imageHtml = imageUrl
        ? `
          <img
            src="${escapeHtml(imageUrl)}"
            alt="${escapeHtml(p.name || 'Product')}"
            loading="lazy"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
            style="
              width:52px;
              height:52px;
              border-radius:9px;
              object-fit:cover;
              background:#111827;
              flex-shrink:0;
            "
          >

          <div style="
            display:none;
            width:52px;
            height:52px;
            border-radius:9px;
            background:#111827;
            align-items:center;
            justify-content:center;
            color:#64748b;
            flex-shrink:0;
          ">
            <i class="fas fa-image"></i>
          </div>
        `
        : `
          <div style="
            width:52px;
            height:52px;
            border-radius:9px;
            background:#111827;
            display:flex;
            align-items:center;
            justify-content:center;
            color:#64748b;
            flex-shrink:0;
          ">
            <i class="fas fa-image"></i>
          </div>
        `;

      /* --------------------------------------------------------
         Price
      -------------------------------------------------------- */

      const salePrice = formatPrice(p.price);

      const hasOriginalPrice =
        p.original_price !== null &&
        p.original_price !== undefined &&
        p.original_price !== '' &&
        Number(p.original_price) > Number(p.price || 0);

      const originalPriceHtml = hasOriginalPrice
        ? `
          <span style="
            text-decoration:line-through;
            color:#64748b;
            font-size:0.72rem;
            margin-left:5px;
          ">
            ${formatPrice(p.original_price)}
          </span>
        `
        : '';

      /* --------------------------------------------------------
         Stock
      -------------------------------------------------------- */

      const stockNumber =
        p.stock === null ||
        p.stock === undefined ||
        p.stock === ''
          ? null
          : Number(p.stock);

      let stockColor = '#94a3b8';

      if (stockNumber !== null && !Number.isNaN(stockNumber)) {
        if (stockNumber <= 0) {
          stockColor = '#f87171';
        } else if (stockNumber < 10) {
          stockColor = '#fbbf24';
        } else {
          stockColor = '#34d399';
        }
      }

      /* --------------------------------------------------------
         Caption
      -------------------------------------------------------- */

      const captionHtml = instagramProduct && caption
        ? `
          <div
            title="${escapeHtml(caption)}"
            style="
              margin-top:7px;
              max-width:320px;
              font-size:0.68rem;
              line-height:1.45;
              color:#64748b;
              white-space:normal;
            "
          >
            ${escapeHtml(captionPreview)}
          </div>
        `
        : '';

      /* --------------------------------------------------------
         Instagram link
      -------------------------------------------------------- */

      const instagramLinkHtml =
        instagramProduct && instagramLink
          ? `
            <a
              href="${escapeHtml(instagramLink)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                display:inline-flex;
                align-items:center;
                gap:5px;
                margin-top:6px;
                color:#c084fc;
                font-size:0.7rem;
                text-decoration:none;
              "
            >
              <i class="fab fa-instagram"></i>
              View Instagram Post
            </a>
          `
          : '';

      /* --------------------------------------------------------
         Row
      -------------------------------------------------------- */

      return `
        <tr>

          <!-- Product -->
          <td>
            <div style="
              display:flex;
              align-items:flex-start;
              gap:0.75rem;
              min-width:250px;
            ">

              ${imageHtml}

              <div style="min-width:0;">

                <div style="
                  display:flex;
                  align-items:center;
                  gap:7px;
                  flex-wrap:wrap;
                ">

                  <strong style="
                    color:#fff;
                    font-size:0.85rem;
                  ">
                    ${escapeHtml(p.name || 'Unnamed Product')}
                  </strong>

                  ${sourceHtml}

                </div>

                <div style="
                  font-size:0.68rem;
                  color:#64748b;
                  margin-top:3px;
                ">
                  SKU: ${escapeHtml(p.id || '—')}
                </div>

                ${captionHtml}

                ${instagramLinkHtml}

              </div>

            </div>
          </td>

          <!-- Category -->
          <td>
            <span style="
              background:rgba(255,255,255,0.06);
              padding:4px 8px;
              border-radius:5px;
              font-size:0.72rem;
              color:#cbd5e1;
            ">
              ${escapeHtml(p.category || 'Uncategorized')}
            </span>
          </td>

          <!-- Price -->
          <td>
            <span style="
              color:#34d399;
              font-weight:700;
              font-size:0.9rem;
            ">
              ${salePrice}
            </span>

            ${originalPriceHtml}
          </td>

          <!-- Stock -->
          <td>
            <span style="
              color:${stockColor};
              font-weight:600;
              font-size:0.75rem;
            ">
              ${formatStock(p.stock)}
            </span>
          </td>

          <!-- Details -->
          <td>
            ${detailsHtml}
          </td>

          <!-- Triggers -->
          <td>
            ${
              Array.isArray(p.ad_triggers) && p.ad_triggers.length
                ? `
                  <code style="
                    font-size:0.65rem;
                    color:#94a3b8;
                    white-space:normal;
                  ">
                    ${escapeHtml(p.ad_triggers.join(', '))}
                  </code>
                `
                : `
                  <span style="
                    color:#475569;
                    font-size:0.7rem;
                  ">
                    —
                  </span>
                `
            }
          </td>

          <!-- Source -->
          <td>
            ${sourceHtml}

            ${
              p.instagram_media_id
                ? `
                  <div style="
                    margin-top:5px;
                    font-size:0.62rem;
                    color:#475569;
                  ">
                    Media ID:
                    ${escapeHtml(p.instagram_media_id)}
                  </div>
                `
                : ''
            }
          </td>

          <!-- Actions -->
          <td>

            <button
              class="btn btn-secondary"
              style="
                width:auto;
                padding:4px 8px;
                font-size:0.72rem;
              "
              onclick="${instagramProduct ? 'editInstagramProduct' : 'editMyProduct'}('${escapeHtml(p.id)}')"
            >
              <i class="fas fa-edit"></i>
              Edit
            </button>

            <button
              class="btn btn-secondary"
              title="Delete product"
              style="
                width:auto;
                padding:4px 8px;
                font-size:0.72rem;
                margin-left:4px;
                border-color:#ef4444;
                color:#f87171;
              "
              onclick="deleteCatalogProduct('${escapeHtml(p.id)}')"
            >
              <i class="fas fa-trash"></i>
            </button>


          </td>

        </tr>
      `;

    }).join('');
  }

  /* ------------------------------------------------------------
     Instagram Sync
  ------------------------------------------------------------ */

  async function syncInstagramCatalog() {

    const filter = document.getElementById('catalog-store-filter');

    const storeType =
      filter && filter.value
        ? filter.value
        : 'clothing';

    const button =
      document.getElementById('instagram-sync-btn');

    const originalButtonHtml =
      button ? button.innerHTML : '';

    try {

      if (button) {
        button.disabled = true;

        button.innerHTML = `
          <i class="fas fa-spinner fa-spin"></i>
          Syncing Instagram...
        `;
      }

      setCatalogStatus(
        'Fetching products from Instagram...',
        'loading'
      );

      const res = await fetch(
        '/api/catalog/sync-instagram',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': storeType
          },
          body: JSON.stringify({
            store_id: storeType,
            store_type: storeType
          })
        }
      );

      if (!res.ok) {
        throw new Error(
          `Instagram sync returned ${res.status}`
        );
      }

      const data = await res.json();

      console.log(
        '[Instagram Catalog Sync]',
        data
      );

      if (!data.success) {
        throw new Error(
          data.message || 'Instagram sync failed'
        );
      }

      const added =
        Number(data.added || 0);

      const updated =
        Number(data.updated || 0);

      const total =
        Number(data.total || 0);

      setCatalogStatus(
        `Instagram synced: ${total} product(s), ${added} added, ${updated} updated`,
        'success'
      );

      await loadCatalogView();

      showCatalogToast(
        `Instagram catalog synced successfully. ${total} product(s) available.`,
        'success'
      );

    } catch (err) {

      console.error(
        '[Instagram Catalog Sync Error]',
        err
      );

      setCatalogStatus(
        `Instagram sync failed: ${err.message}`,
        'error'
      );

      showCatalogToast(
        `Instagram sync failed: ${err.message}`,
        'error'
      );

    } finally {

      if (button) {
        button.disabled = false;

        button.innerHTML =
          originalButtonHtml ||
          `
            <i class="fab fa-instagram"></i>
            Sync Instagram
          `;
      }

    }
  }

  /* ------------------------------------------------------------
     Catalog Status
  ------------------------------------------------------------ */

  function setCatalogStatus(message, type) {

    let status =
      document.getElementById(
        'catalog-sync-status'
      );

    if (!status) {

      const filter =
        document.getElementById(
          'catalog-store-filter'
        );

      if (!filter) return;

      status =
        document.createElement('div');

      status.id =
        'catalog-sync-status';

      status.style.cssText = `
        margin-top:8px;
        font-size:0.72rem;
        color:#64748b;
      `;

      filter.parentElement &&
        filter.parentElement.appendChild(status);
    }

    let color = '#64748b';

    if (type === 'success') {
      color = '#34d399';
    }

    if (type === 'error') {
      color = '#f87171';
    }

    if (type === 'loading') {
      color = '#fbbf24';
    }

    status.innerHTML = `
      <span style="color:${color};">
        ${escapeHtml(message)}
      </span>
    `;
  }

  /* ------------------------------------------------------------
     Toast
  ------------------------------------------------------------ */

  function showCatalogToast(message, type) {

    let toast =
      document.getElementById(
        'catalog-toast'
      );

    if (!toast) {

      toast =
        document.createElement('div');

      toast.id =
        'catalog-toast';

      toast.style.cssText = `
        position:fixed;
        right:20px;
        bottom:20px;
        z-index:99999;
        max-width:420px;
        padding:13px 16px;
        border-radius:10px;
        font-size:0.82rem;
        line-height:1.4;
        box-shadow:0 10px 30px rgba(0,0,0,0.35);
        transition:opacity .2s ease;
      `;

      document.body.appendChild(toast);
    }

    toast.style.background =
      type === 'error'
        ? '#3f1d1d'
        : '#102d24';

    toast.style.border =
      type === 'error'
        ? '1px solid #7f1d1d'
        : '1px solid #065f46';

    toast.style.color =
      type === 'error'
        ? '#fca5a5'
        : '#a7f3d0';

    toast.innerHTML =
      escapeHtml(message);

    toast.style.opacity = '1';

    clearTimeout(
      toast._hideTimer
    );

    toast._hideTimer =
      setTimeout(() => {
        toast.style.opacity = '0';
      }, 4500);
  }

  /* ------------------------------------------------------------
     Add Product
  ------------------------------------------------------------ */

  function openAddProductModal() {

    const filter =
      document.getElementById(
        'catalog-store-filter'
      );

    const storeType =
      filter && filter.value
        ? filter.value
        : 'clothing';

    const name = prompt(
      `Enter ${
        storeType === 'clothing'
          ? 'Apparel'
          : 'Gadget'
      } Product Name:`
    );

    if (!name) return;

    const price =
      parseFloat(
        prompt(
          'Enter Sale Price (₹):',
          '799'
        )
      );

    if (isNaN(price)) return;

    const newProduct = {

      store_type: storeType,

      name: name,

      category:
        storeType === 'clothing'
          ? 'Streetwear & Tops'
          : 'Tech & Audio',

      price: price,

      original_price:
        +(price * 1.5).toFixed(2),

      stock: 20,

      image_url:
        storeType === 'clothing'
          ? 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&fit=crop'
          : 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&fit=crop',

      checkout_url:
        `https://shop.mystore.com/checkout?ref=ig_dm&item=${encodeURIComponent(name)}`,

      sizes:
        storeType === 'clothing'
          ? ['S', 'M', 'L', 'XL']
          : null,

      specs:
        storeType === 'electronics'
          ? {
              Battery: '24 Hours',
              Warranty: '1 Year'
            }
          : null,

      ad_triggers: [
        'viral_drop',
        'new_arrival'
      ],

      source: 'manual'
    };

    fetch(
      '/api/catalog/products',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          'x-store-id': storeType
        },
        body:
          JSON.stringify(newProduct)
      }
    )
      .then(async (res) => {

        if (!res.ok) {
          throw new Error(
            `Server returned ${res.status}`
          );
        }

        return res.json();
      })
      .then((data) => {

        if (data && data.success === false) {
          throw new Error(
            data.message ||
            'Failed to add product'
          );
        }

        showCatalogToast(
          'Product added successfully.',
          'success'
        );

        loadCatalogView();

      })
      .catch((err) => {

        console.error(
          'Failed to add product:',
          err
        );

        showCatalogToast(
          `Failed to add product: ${err.message}`,
          'error'
        );

      });
  }

  /* ------------------------------------------------------------
     Edit / Delete
     Instagram products are edited in the same form as manual ones.
     Edits and deletes are remembered, so "Sync Instagram" never undoes them.
  ------------------------------------------------------------ */

  function editInstagramProduct(id) {

    const product = lastProducts.find(
      (p) => String(p.id) === String(id)
    );

    if (!product) {
      showCatalogToast(
        'Product not found. Refresh the catalog and try again.',
        'error'
      );
      return;
    }

    if (typeof window.openProductForm !== 'function') {
      showCatalogToast(
        'The product form is not loaded. Refresh the page.',
        'error'
      );
      return;
    }

    window.openProductForm(product, { catalog: true });
  }

  async function deleteCatalogProduct(id) {

    const product = lastProducts.find(
      (p) => String(p.id) === String(id)
    );

    const name = product && product.name
      ? String(product.name).substring(0, 60)
      : 'this product';

    const note = isInstagramProduct(product)
      ? ' It will stay deleted even after you press Sync Instagram.'
      : '';

    if (
      !confirm(
        `Delete "${name}"? It will disappear from your WhatsApp catalogue.${note}`
      )
    ) {
      return;
    }

    try {

      const storeId = catalogStoreId();

      const res = await fetch(
        `/api/catalog/products/${encodeURIComponent(id)}?store_id=${encodeURIComponent(storeId)}`,
        {
          method: 'DELETE',
          headers: { 'x-store-id': storeId }
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.success === false) {
        throw new Error(
          (data && data.message) ||
          `Server returned ${res.status}`
        );
      }

      showCatalogToast(
        'Product deleted.',
        'success'
      );

      await loadCatalogView();

      if (typeof window.loadMyProducts === 'function') {
        window.loadMyProducts();
      }

    } catch (err) {

      console.error(
        'Failed to delete product:',
        err
      );

      showCatalogToast(
        `Failed to delete product: ${err.message}`,
        'error'
      );

    }
  }

  /* ------------------------------------------------------------
     Add Sync Button Automatically
     
     We don't require an index.html change.
     This adds the button near the catalog filter.
  ------------------------------------------------------------ */

  function ensureInstagramSyncButton() {

    if (
      document.getElementById(
        'instagram-sync-btn'
      )
    ) {
      return;
    }

    const filter =
      document.getElementById(
        'catalog-store-filter'
      );

    if (!filter) {
      return;
    }

    const parent =
      filter.parentElement;

    if (!parent) {
      return;
    }

    const button =
      document.createElement('button');

    button.id =
      'instagram-sync-btn';

    button.type =
      'button';

    button.className =
      'btn btn-secondary';

    button.style.cssText = `
      margin-left:8px;
      width:auto;
      padding:8px 12px;
      font-size:0.78rem;
      border:1px solid rgba(225,48,108,0.35);
      background:rgba(225,48,108,0.10);
      color:#f9a8d4;
    `;

    button.innerHTML = `
      <i class="fab fa-instagram"></i>
      Sync Instagram
    `;

    button.addEventListener(
      'click',
      syncInstagramCatalog
    );

    parent.appendChild(button);

    /* Add refresh button too */

    const refreshButton =
      document.createElement('button');

    refreshButton.type =
      'button';

    refreshButton.className =
      'btn btn-secondary';

    refreshButton.style.cssText = `
      margin-left:6px;
      width:auto;
      padding:8px 10px;
      font-size:0.78rem;
    `;

    refreshButton.innerHTML = `
      <i class="fas fa-sync-alt"></i>
    `;

    refreshButton.title =
      'Refresh catalog';

    refreshButton.addEventListener(
      'click',
      loadCatalogView
    );

    parent.appendChild(
      refreshButton
    );
  }

  /* ------------------------------------------------------------
     Public API
  ------------------------------------------------------------ */

  window.loadCatalogView =
    loadCatalogView;

  window.filterCatalog =
    filterCatalog;

  window.renderCatalogTable =
    renderCatalogTable;

  window.openAddProductModal =
    openAddProductModal;

  window.editInstagramProduct =
    editInstagramProduct;

  window.deleteCatalogProduct =
    deleteCatalogProduct;

  // old name kept so nothing else breaks
  window.editProductPrompt =
    editInstagramProduct;

  window.syncInstagramCatalog =
    syncInstagramCatalog;

  /* ------------------------------------------------------------
     Initialisation
  ------------------------------------------------------------ */

  function initCatalog() {

    ensureInstagramSyncButton();

    /*
      Give the existing dashboard a moment to finish
      rendering its HTML before loading products.
    */

    setTimeout(() => {

      ensureInstagramSyncButton();

      loadCatalogView();

    }, 300);
  }

  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      initCatalog
    );

  } else {

    initCatalog();

  }

})();




// async function loadCatalogView() {
//   const storeType = document.getElementById('catalog-store-filter').value;
//   try {
//     const res = await fetch(`/api/catalog/products?store_type=${storeType}`);
//     const data = await res.json();
//     if (data.success) {
//       renderCatalogTable(data.products, storeType);
//     }
//   } catch (err) {
//     console.error('Failed to load catalog:', err);
//   }
// }

// function filterCatalog() {
//   loadCatalogView();
// }

// function renderCatalogTable(products, storeType) {
//   const tbody = document.getElementById('catalog-table-body');
//   if (!products || products.length === 0) {
//     tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No products found in this category.</td></tr>';
//     return;
//   }

//   tbody.innerHTML = products.map(p => {
//     let detailsHtml = '';
//     if (p.store_type === 'clothing') {
//       detailsHtml = `
//         <div style="font-size: 0.75rem; color: #94a3b8;">
//           <div><strong>Sizes:</strong> ${(p.sizes || []).join(', ')}</div>
//           <div><strong>Fabric:</strong> ${p.fabric || 'Premium Cotton'}</div>
//           <div><strong>Fit:</strong> ${p.fit_type || 'Oversized'}</div>
//         </div>
//       `;
//     } else {
//       const specsSummary = p.specs ? Object.entries(p.specs).slice(0, 2).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join('<br>') : 'Standard Tech Specs';
//       detailsHtml = `
//         <div style="font-size: 0.75rem; color: #94a3b8;">
//           ${specsSummary}
//         </div>
//       `;
//     }

//     return `
//       <tr>
//         <td>
//           <div style="display: flex; align-items: center; gap: 0.75rem;">
//             <img src="${p.image_url}" alt="${p.name}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover;">
//             <div>
//               <strong style="color: #fff; font-size: 0.85rem;">${p.name}</strong>
//               <div style="font-size: 0.72rem; color: #64748b;">SKU: ${p.id}</div>
//             </div>
//           </div>
//         </td>
//         <td><span style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; font-size: 0.75rem;">${p.category}</span></td>
//         <td>
//           <span style="color: #34d399; font-weight: 700;">$${p.price}</span>
//           <span style="text-decoration: line-through; color: #64748b; font-size: 0.75rem; margin-left: 4px;">$${p.original_price}</span>
//         </td>
//         <td>
//           <span style="color: ${p.stock < 10 ? '#f87171' : '#34d399'}; font-weight: 600;">${p.stock} in stock</span>
//         </td>
//         <td>${detailsHtml}</td>
//         <td>
//           <code>${(p.ad_triggers || []).join(', ')}</code>
//         </td>
//         <td>
//           <button class="btn btn-secondary" style="width: auto; padding: 4px 8px; font-size: 0.75rem;" onclick="editProductPrompt('${p.id}')">
//             <i class="fas fa-edit"></i> Edit
//           </button>
//         </td>
//       </tr>
//     `;
//   }).join('');
// }

// function openAddProductModal() {
//   const storeType = document.getElementById('catalog-store-filter').value;
//   const name = prompt(`Enter ${storeType === 'clothing' ? 'Apparel' : 'Gadget'} Product Name:`);
//   if (!name) return;
//   const price = parseFloat(prompt('Enter Sale Price ($):', '49.99'));
//   if (isNaN(price)) return;

//   const newProduct = {
//     store_type: storeType,
//     name: name,
//     category: storeType === 'clothing' ? 'Streetwear & Tops' : 'Tech & Audio',
//     price: price,
//     original_price: +(price * 1.5).toFixed(2),
//     stock: 20,
//     image_url: storeType === 'clothing' 
//       ? 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&fit=crop'
//       : 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&fit=crop',
//     checkout_url: `https://shop.mystore.com/checkout?ref=ig_dm&item=${encodeURIComponent(name)}`,
//     sizes: storeType === 'clothing' ? ['S', 'M', 'L', 'XL'] : null,
//     specs: storeType === 'electronics' ? { 'Battery': '24 Hours', 'Warranty': '1 Year' } : null,
//     ad_triggers: ['viral_drop', 'new_arrival']
//   };

//   fetch('/api/catalog/products', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify(newProduct)
//   }).then(() => loadCatalogView());
// }

// function editProductPrompt(id) {
//   const newPrice = prompt('Enter updated price ($):');
//   if (newPrice && !isNaN(parseFloat(newPrice))) {
//     fetch(`/api/catalog/products/${id}`, {
//       method: 'PUT',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ price: parseFloat(newPrice) })
//     }).then(() => loadCatalogView());
//   }
// }


//21/9


/* ============================================================
   AI SALES BOT - CATALOG DASHBOARD
   Instagram Product Catalog + Manual Products
   ============================================================ */

// (function () {
//   'use strict';

//   /* ------------------------------------------------------------
//      Helpers
//   ------------------------------------------------------------ */

//   function escapeHtml(value) {
//     if (value === null || value === undefined) return '';

//     return String(value)
//       .replace(/&/g, '&amp;')
//       .replace(/</g, '&lt;')
//       .replace(/>/g, '&gt;')
//       .replace(/"/g, '&quot;')
//       .replace(/'/g, '&#039;');
//   }

//   function formatPrice(value) {
//     if (value === null || value === undefined || value === '') {
//       return '₹—';
//     }

//     const number = Number(value);

//     if (Number.isNaN(number)) {
//       return `₹${escapeHtml(value)}`;
//     }

//     return `₹${number.toLocaleString('en-IN')}`;
//   }

//   function formatStock(stock) {
//     if (stock === null || stock === undefined || stock === '') {
//       return 'Not specified';
//     }

//     const number = Number(stock);

//     if (Number.isNaN(number)) {
//       return escapeHtml(stock);
//     }

//     if (number <= 0) {
//       return 'Out of stock';
//     }

//     return `${number} in stock`;
//   }

//   function getSourceBadge(product) {
//     const isInstagram =
//       product.source === 'instagram' ||
//       product.instagram_media_id ||
//       product.instagram_account_id ||
//       product.instagram_url;

//     if (isInstagram) {
//       return `
//         <span style="
//           display:inline-flex;
//           align-items:center;
//           gap:5px;
//           padding:4px 8px;
//           border-radius:999px;
//           background:rgba(225,48,108,0.14);
//           border:1px solid rgba(225,48,108,0.25);
//           color:#f472b6;
//           font-size:0.68rem;
//           font-weight:700;
//         ">
//           <i class="fab fa-instagram"></i>
//           INSTAGRAM
//         </span>
//       `;
//     }

//     return `
//       <span style="
//         display:inline-flex;
//         align-items:center;
//         padding:4px 8px;
//         border-radius:999px;
//         background:rgba(255,255,255,0.06);
//         color:#94a3b8;
//         font-size:0.68rem;
//         font-weight:600;
//       ">
//         MANUAL
//       </span>
//     `;
//   }

//   function isInstagramProduct(product) {
//     return (
//       product &&
//       (
//         product.source === 'instagram' ||
//         product.instagram_media_id ||
//         product.instagram_account_id ||
//         product.instagram_url
//       )
//     );
//   }

//   /* ------------------------------------------------------------
//      Load Catalog
//   ------------------------------------------------------------ */

//   async function loadCatalogView() {
//     const filter = document.getElementById('catalog-store-filter');

//     const storeType = filter
//       ? filter.value
//       : 'clothing';

//     try {
//       setCatalogStatus('Loading catalog...', 'loading');

//       const res = await fetch(
//         `/api/catalog/products?store_type=${encodeURIComponent(storeType)}`,
//         {
//           method: 'GET',
//           cache: 'no-store'
//         }
//       );

//       if (!res.ok) {
//         throw new Error(`Catalog API returned ${res.status}`);
//       }

//       const data = await res.json();

//       if (data.success) {
//         renderCatalogTable(data.products || [], storeType);

//         setCatalogStatus(
//           `${(data.products || []).length} product(s) loaded`,
//           'success'
//         );
//       } else {
//         throw new Error(data.message || 'Failed to load catalog');
//       }

//     } catch (err) {
//       console.error('Failed to load catalog:', err);

//       setCatalogStatus(
//         'Failed to load catalog',
//         'error'
//       );

//       const tbody = document.getElementById('catalog-table-body');

//       if (tbody) {
//         tbody.innerHTML = `
//           <tr>
//             <td colspan="8" style="
//               text-align:center;
//               padding:30px;
//               color:#f87171;
//             ">
//               Failed to load catalog.
//               <br>
//               <small style="color:#94a3b8;">
//                 ${escapeHtml(err.message)}
//               </small>
//             </td>
//           </tr>
//         `;
//       }
//     }
//   }

//   /* ------------------------------------------------------------
//      Filter
//   ------------------------------------------------------------ */

//   function filterCatalog() {
//     loadCatalogView();
//   }

//   /* ------------------------------------------------------------
//      Render Catalog
//   ------------------------------------------------------------ */

//   function renderCatalogTable(products, storeType) {
//     const tbody = document.getElementById('catalog-table-body');

//     if (!tbody) {
//       console.error('catalog-table-body not found');
//       return;
//     }

//     if (!products || products.length === 0) {
//       tbody.innerHTML = `
//         <tr>
//           <td colspan="8" style="
//             text-align:center;
//             padding:40px 20px;
//             color:#888;
//           ">
//             <div style="font-size:2rem;margin-bottom:10px;">
//               📦
//             </div>

//             <strong>No products found</strong>

//             <div style="
//               margin-top:8px;
//               font-size:0.8rem;
//               color:#64748b;
//             ">
//               Click "Sync Instagram" to import products from your Instagram account.
//             </div>
//           </td>
//         </tr>
//       `;

//       return;
//     }

//     tbody.innerHTML = products.map((p) => {

//       /* --------------------------------------------------------
//          Product details
//       -------------------------------------------------------- */

//       let detailsHtml = '';

//       if (p.store_type === 'clothing') {

//         const sizes = Array.isArray(p.sizes)
//           ? p.sizes.join(', ')
//           : (p.sizes || 'Not specified');

//         const colors = Array.isArray(p.colors)
//           ? p.colors.join(', ')
//           : (p.colors || 'Not specified');

//         detailsHtml = `
//           <div style="
//             font-size:0.72rem;
//             color:#94a3b8;
//             line-height:1.6;
//           ">
//             <div>
//               <strong>Sizes:</strong>
//               ${escapeHtml(sizes)}
//             </div>

//             <div>
//               <strong>Colors:</strong>
//               ${escapeHtml(colors)}
//             </div>

//             ${
//               p.fabric
//                 ? `
//                   <div>
//                     <strong>Fabric:</strong>
//                     ${escapeHtml(p.fabric)}
//                   </div>
//                 `
//                 : ''
//             }

//             ${
//               p.fit_type
//                 ? `
//                   <div>
//                     <strong>Fit:</strong>
//                     ${escapeHtml(p.fit_type)}
//                   </div>
//                 `
//                 : ''
//             }
//           </div>
//         `;

//       } else {

//         const specsSummary =
//           p.specs && typeof p.specs === 'object'
//             ? Object.entries(p.specs)
//                 .slice(0, 3)
//                 .map(
//                   ([k, v]) =>
//                     `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}`
//                 )
//                 .join('<br>')
//             : 'Standard Tech Specs';

//         detailsHtml = `
//           <div style="
//             font-size:0.72rem;
//             color:#94a3b8;
//             line-height:1.6;
//           ">
//             ${specsSummary}
//           </div>
//         `;
//       }

//       /* --------------------------------------------------------
//          Instagram information
//       -------------------------------------------------------- */

//       const instagramProduct = isInstagramProduct(p);

//       const instagramLink =
//         p.instagram_url ||
//         p.permalink ||
//         '';

//       const caption =
//         p.caption ||
//         '';

//       const captionPreview =
//         caption.length > 180
//           ? `${caption.substring(0, 180)}...`
//           : caption;

//       const sourceHtml = getSourceBadge(p);

//       const imageUrl =
//         p.image_url ||
//         p.media_url ||
//         p.thumbnail_url ||
//         '';

//       const imageHtml = imageUrl
//         ? `
//           <img
//             src="${escapeHtml(imageUrl)}"
//             alt="${escapeHtml(p.name || 'Product')}"
//             loading="lazy"
//             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
//             style="
//               width:52px;
//               height:52px;
//               border-radius:9px;
//               object-fit:cover;
//               background:#111827;
//               flex-shrink:0;
//             "
//           >

//           <div style="
//             display:none;
//             width:52px;
//             height:52px;
//             border-radius:9px;
//             background:#111827;
//             align-items:center;
//             justify-content:center;
//             color:#64748b;
//             flex-shrink:0;
//           ">
//             <i class="fas fa-image"></i>
//           </div>
//         `
//         : `
//           <div style="
//             width:52px;
//             height:52px;
//             border-radius:9px;
//             background:#111827;
//             display:flex;
//             align-items:center;
//             justify-content:center;
//             color:#64748b;
//             flex-shrink:0;
//           ">
//             <i class="fas fa-image"></i>
//           </div>
//         `;

//       /* --------------------------------------------------------
//          Price
//       -------------------------------------------------------- */

//       const salePrice = formatPrice(p.price);

//       const hasOriginalPrice =
//         p.original_price !== null &&
//         p.original_price !== undefined &&
//         p.original_price !== '' &&
//         Number(p.original_price) > Number(p.price || 0);

//       const originalPriceHtml = hasOriginalPrice
//         ? `
//           <span style="
//             text-decoration:line-through;
//             color:#64748b;
//             font-size:0.72rem;
//             margin-left:5px;
//           ">
//             ${formatPrice(p.original_price)}
//           </span>
//         `
//         : '';

//       /* --------------------------------------------------------
//          Stock
//       -------------------------------------------------------- */

//       const stockNumber =
//         p.stock === null ||
//         p.stock === undefined ||
//         p.stock === ''
//           ? null
//           : Number(p.stock);

//       let stockColor = '#94a3b8';

//       if (stockNumber !== null && !Number.isNaN(stockNumber)) {
//         if (stockNumber <= 0) {
//           stockColor = '#f87171';
//         } else if (stockNumber < 10) {
//           stockColor = '#fbbf24';
//         } else {
//           stockColor = '#34d399';
//         }
//       }

//       /* --------------------------------------------------------
//          Caption
//       -------------------------------------------------------- */

//       const captionHtml = instagramProduct && caption
//         ? `
//           <div
//             title="${escapeHtml(caption)}"
//             style="
//               margin-top:7px;
//               max-width:320px;
//               font-size:0.68rem;
//               line-height:1.45;
//               color:#64748b;
//               white-space:normal;
//             "
//           >
//             ${escapeHtml(captionPreview)}
//           </div>
//         `
//         : '';

//       /* --------------------------------------------------------
//          Instagram link
//       -------------------------------------------------------- */

//       const instagramLinkHtml =
//         instagramProduct && instagramLink
//           ? `
//             <a
//               href="${escapeHtml(instagramLink)}"
//               target="_blank"
//               rel="noopener noreferrer"
//               style="
//                 display:inline-flex;
//                 align-items:center;
//                 gap:5px;
//                 margin-top:6px;
//                 color:#c084fc;
//                 font-size:0.7rem;
//                 text-decoration:none;
//               "
//             >
//               <i class="fab fa-instagram"></i>
//               View Instagram Post
//             </a>
//           `
//           : '';

//       /* --------------------------------------------------------
//          Row
//       -------------------------------------------------------- */

//       return `
//         <tr>

//           <!-- Product -->
//           <td>
//             <div style="
//               display:flex;
//               align-items:flex-start;
//               gap:0.75rem;
//               min-width:250px;
//             ">

//               ${imageHtml}

//               <div style="min-width:0;">

//                 <div style="
//                   display:flex;
//                   align-items:center;
//                   gap:7px;
//                   flex-wrap:wrap;
//                 ">

//                   <strong style="
//                     color:#fff;
//                     font-size:0.85rem;
//                   ">
//                     ${escapeHtml(p.name || 'Unnamed Product')}
//                   </strong>

//                   ${sourceHtml}

//                 </div>

//                 <div style="
//                   font-size:0.68rem;
//                   color:#64748b;
//                   margin-top:3px;
//                 ">
//                   SKU: ${escapeHtml(p.id || '—')}
//                 </div>

//                 ${captionHtml}

//                 ${instagramLinkHtml}

//               </div>

//             </div>
//           </td>

//           <!-- Category -->
//           <td>
//             <span style="
//               background:rgba(255,255,255,0.06);
//               padding:4px 8px;
//               border-radius:5px;
//               font-size:0.72rem;
//               color:#cbd5e1;
//             ">
//               ${escapeHtml(p.category || 'Uncategorized')}
//             </span>
//           </td>

//           <!-- Price -->
//           <td>
//             <span style="
//               color:#34d399;
//               font-weight:700;
//               font-size:0.9rem;
//             ">
//               ${salePrice}
//             </span>

//             ${originalPriceHtml}
//           </td>

//           <!-- Stock -->
//           <td>
//             <span style="
//               color:${stockColor};
//               font-weight:600;
//               font-size:0.75rem;
//             ">
//               ${formatStock(p.stock)}
//             </span>
//           </td>

//           <!-- Details -->
//           <td>
//             ${detailsHtml}
//           </td>

//           <!-- Triggers -->
//           <td>
//             ${
//               Array.isArray(p.ad_triggers) && p.ad_triggers.length
//                 ? `
//                   <code style="
//                     font-size:0.65rem;
//                     color:#94a3b8;
//                     white-space:normal;
//                   ">
//                     ${escapeHtml(p.ad_triggers.join(', '))}
//                   </code>
//                 `
//                 : `
//                   <span style="
//                     color:#475569;
//                     font-size:0.7rem;
//                   ">
//                     —
//                   </span>
//                 `
//             }
//           </td>

//           <!-- Source -->
//           <td>
//             ${sourceHtml}

//             ${
//               p.instagram_media_id
//                 ? `
//                   <div style="
//                     margin-top:5px;
//                     font-size:0.62rem;
//                     color:#475569;
//                   ">
//                     Media ID:
//                     ${escapeHtml(p.instagram_media_id)}
//                   </div>
//                 `
//                 : ''
//             }
//           </td>

//           <!-- Actions -->
//           <td>

//             <button
//               class="btn btn-secondary"
//               style="
//                 width:auto;
//                 padding:4px 8px;
//                 font-size:0.72rem;
//               "
//               onclick="editProductPrompt('${escapeHtml(p.id)}')"
//             >
//               <i class="fas fa-edit"></i>
//               Edit
//             </button>

//           </td>

//         </tr>
//       `;

//     }).join('');
//   }

//   /* ------------------------------------------------------------
//      Instagram Sync
//   ------------------------------------------------------------ */

//   async function syncInstagramCatalog() {

//     const filter = document.getElementById('catalog-store-filter');

//     const storeType =
//       filter && filter.value
//         ? filter.value
//         : 'clothing';

//     const button =
//       document.getElementById('instagram-sync-btn');

//     const originalButtonHtml =
//       button ? button.innerHTML : '';

//     try {

//       if (button) {
//         button.disabled = true;

//         button.innerHTML = `
//           <i class="fas fa-spinner fa-spin"></i>
//           Syncing Instagram...
//         `;
//       }

//       setCatalogStatus(
//         'Fetching products from Instagram...',
//         'loading'
//       );

//       const res = await fetch(
//         '/api/catalog/sync-instagram',
//         {
//           method: 'POST',
//           headers: {
//             'Content-Type': 'application/json'
//           },
//           body: JSON.stringify({
//             store_type: storeType
//           })
//         }
//       );

//       if (!res.ok) {
//         throw new Error(
//           `Instagram sync returned ${res.status}`
//         );
//       }

//       const data = await res.json();

//       console.log(
//         '[Instagram Catalog Sync]',
//         data
//       );

//       if (!data.success) {
//         throw new Error(
//           data.message || 'Instagram sync failed'
//         );
//       }

//       const added =
//         Number(data.added || 0);

//       const updated =
//         Number(data.updated || 0);

//       const total =
//         Number(data.total || 0);

//       setCatalogStatus(
//         `Instagram synced: ${total} product(s), ${added} added, ${updated} updated`,
//         'success'
//       );

//       await loadCatalogView();

//       showCatalogToast(
//         `Instagram catalog synced successfully. ${total} product(s) available.`,
//         'success'
//       );

//     } catch (err) {

//       console.error(
//         '[Instagram Catalog Sync Error]',
//         err
//       );

//       setCatalogStatus(
//         `Instagram sync failed: ${err.message}`,
//         'error'
//       );

//       showCatalogToast(
//         `Instagram sync failed: ${err.message}`,
//         'error'
//       );

//     } finally {

//       if (button) {
//         button.disabled = false;

//         button.innerHTML =
//           originalButtonHtml ||
//           `
//             <i class="fab fa-instagram"></i>
//             Sync Instagram
//           `;
//       }

//     }
//   }

//   /* ------------------------------------------------------------
//      Catalog Status
//   ------------------------------------------------------------ */

//   function setCatalogStatus(message, type) {

//     let status =
//       document.getElementById(
//         'catalog-sync-status'
//       );

//     if (!status) {

//       const filter =
//         document.getElementById(
//           'catalog-store-filter'
//         );

//       if (!filter) return;

//       status =
//         document.createElement('div');

//       status.id =
//         'catalog-sync-status';

//       status.style.cssText = `
//         margin-top:8px;
//         font-size:0.72rem;
//         color:#64748b;
//       `;

//       filter.parentElement &&
//         filter.parentElement.appendChild(status);
//     }

//     let color = '#64748b';

//     if (type === 'success') {
//       color = '#34d399';
//     }

//     if (type === 'error') {
//       color = '#f87171';
//     }

//     if (type === 'loading') {
//       color = '#fbbf24';
//     }

//     status.innerHTML = `
//       <span style="color:${color};">
//         ${escapeHtml(message)}
//       </span>
//     `;
//   }

//   /* ------------------------------------------------------------
//      Toast
//   ------------------------------------------------------------ */

//   function showCatalogToast(message, type) {

//     let toast =
//       document.getElementById(
//         'catalog-toast'
//       );

//     if (!toast) {

//       toast =
//         document.createElement('div');

//       toast.id =
//         'catalog-toast';

//       toast.style.cssText = `
//         position:fixed;
//         right:20px;
//         bottom:20px;
//         z-index:99999;
//         max-width:420px;
//         padding:13px 16px;
//         border-radius:10px;
//         font-size:0.82rem;
//         line-height:1.4;
//         box-shadow:0 10px 30px rgba(0,0,0,0.35);
//         transition:opacity .2s ease;
//       `;

//       document.body.appendChild(toast);
//     }

//     toast.style.background =
//       type === 'error'
//         ? '#3f1d1d'
//         : '#102d24';

//     toast.style.border =
//       type === 'error'
//         ? '1px solid #7f1d1d'
//         : '1px solid #065f46';

//     toast.style.color =
//       type === 'error'
//         ? '#fca5a5'
//         : '#a7f3d0';

//     toast.innerHTML =
//       escapeHtml(message);

//     toast.style.opacity = '1';

//     clearTimeout(
//       toast._hideTimer
//     );

//     toast._hideTimer =
//       setTimeout(() => {
//         toast.style.opacity = '0';
//       }, 4500);
//   }

//   /* ------------------------------------------------------------
//      Add Product
//   ------------------------------------------------------------ */

//   function openAddProductModal() {

//     const filter =
//       document.getElementById(
//         'catalog-store-filter'
//       );

//     const storeType =
//       filter && filter.value
//         ? filter.value
//         : 'clothing';

//     const name = prompt(
//       `Enter ${
//         storeType === 'clothing'
//           ? 'Apparel'
//           : 'Gadget'
//       } Product Name:`
//     );

//     if (!name) return;

//     const price =
//       parseFloat(
//         prompt(
//           'Enter Sale Price (₹):',
//           '799'
//         )
//       );

//     if (isNaN(price)) return;

//     const newProduct = {

//       store_type: storeType,

//       name: name,

//       category:
//         storeType === 'clothing'
//           ? 'Streetwear & Tops'
//           : 'Tech & Audio',

//       price: price,

//       original_price:
//         +(price * 1.5).toFixed(2),

//       stock: 20,

//       image_url:
//         storeType === 'clothing'
//           ? 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&fit=crop'
//           : 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&fit=crop',

//       checkout_url:
//         `https://shop.mystore.com/checkout?ref=ig_dm&item=${encodeURIComponent(name)}`,

//       sizes:
//         storeType === 'clothing'
//           ? ['S', 'M', 'L', 'XL']
//           : null,

//       specs:
//         storeType === 'electronics'
//           ? {
//               Battery: '24 Hours',
//               Warranty: '1 Year'
//             }
//           : null,

//       ad_triggers: [
//         'viral_drop',
//         'new_arrival'
//       ],

//       source: 'manual'
//     };

//     fetch(
//       '/api/catalog/products',
//       {
//         method: 'POST',
//         headers: {
//           'Content-Type':
//             'application/json'
//         },
//         body:
//           JSON.stringify(newProduct)
//       }
//     )
//       .then(async (res) => {

//         if (!res.ok) {
//           throw new Error(
//             `Server returned ${res.status}`
//           );
//         }

//         return res.json();
//       })
//       .then((data) => {

//         if (data && data.success === false) {
//           throw new Error(
//             data.message ||
//             'Failed to add product'
//           );
//         }

//         showCatalogToast(
//           'Product added successfully.',
//           'success'
//         );

//         loadCatalogView();

//       })
//       .catch((err) => {

//         console.error(
//           'Failed to add product:',
//           err
//         );

//         showCatalogToast(
//           `Failed to add product: ${err.message}`,
//           'error'
//         );

//       });
//   }

//   /* ------------------------------------------------------------
//      Edit Product
//   ------------------------------------------------------------ */

//   function editProductPrompt(id) {

//     const newPrice =
//       prompt(
//         'Enter updated price (₹):'
//       );

//     if (
//       newPrice &&
//       !isNaN(
//         parseFloat(newPrice)
//       )
//     ) {

//       fetch(
//         `/api/catalog/products/${encodeURIComponent(id)}`,
//         {
//           method: 'PUT',
//           headers: {
//             'Content-Type':
//               'application/json'
//           },
//           body:
//             JSON.stringify({
//               price:
//                 parseFloat(newPrice)
//             })
//         }
//       )
//         .then(async (res) => {

//           if (!res.ok) {
//             throw new Error(
//               `Server returned ${res.status}`
//             );
//           }

//           return res.json();

//         })
//         .then((data) => {

//           if (
//             data &&
//             data.success === false
//           ) {
//             throw new Error(
//               data.message ||
//               'Failed to update product'
//             );
//           }

//           showCatalogToast(
//             'Product updated successfully.',
//             'success'
//           );

//           loadCatalogView();

//         })
//         .catch((err) => {

//           console.error(
//             'Failed to update product:',
//             err
//           );

//           showCatalogToast(
//             `Failed to update product: ${err.message}`,
//             'error'
//           );

//         });
//     }
//   }

//   /* ------------------------------------------------------------
//      Add Sync Button Automatically
     
//      We don't require an index.html change.
//      This adds the button near the catalog filter.
//   ------------------------------------------------------------ */

//   function ensureInstagramSyncButton() {

//     if (
//       document.getElementById(
//         'instagram-sync-btn'
//       )
//     ) {
//       return;
//     }

//     const filter =
//       document.getElementById(
//         'catalog-store-filter'
//       );

//     if (!filter) {
//       return;
//     }

//     const parent =
//       filter.parentElement;

//     if (!parent) {
//       return;
//     }

//     const button =
//       document.createElement('button');

//     button.id =
//       'instagram-sync-btn';

//     button.type =
//       'button';

//     button.className =
//       'btn btn-secondary';

//     button.style.cssText = `
//       margin-left:8px;
//       width:auto;
//       padding:8px 12px;
//       font-size:0.78rem;
//       border:1px solid rgba(225,48,108,0.35);
//       background:rgba(225,48,108,0.10);
//       color:#f9a8d4;
//     `;

//     button.innerHTML = `
//       <i class="fab fa-instagram"></i>
//       Sync Instagram
//     `;

//     button.addEventListener(
//       'click',
//       syncInstagramCatalog
//     );

//     parent.appendChild(button);

//     /* Add refresh button too */

//     const refreshButton =
//       document.createElement('button');

//     refreshButton.type =
//       'button';

//     refreshButton.className =
//       'btn btn-secondary';

//     refreshButton.style.cssText = `
//       margin-left:6px;
//       width:auto;
//       padding:8px 10px;
//       font-size:0.78rem;
//     `;

//     refreshButton.innerHTML = `
//       <i class="fas fa-sync-alt"></i>
//     `;

//     refreshButton.title =
//       'Refresh catalog';

//     refreshButton.addEventListener(
//       'click',
//       loadCatalogView
//     );

//     parent.appendChild(
//       refreshButton
//     );
//   }

//   /* ------------------------------------------------------------
//      Public API
//   ------------------------------------------------------------ */

//   window.loadCatalogView =
//     loadCatalogView;

//   window.filterCatalog =
//     filterCatalog;

//   window.renderCatalogTable =
//     renderCatalogTable;

//   window.openAddProductModal =
//     openAddProductModal;

//   window.editProductPrompt =
//     editProductPrompt;

//   window.syncInstagramCatalog =
//     syncInstagramCatalog;

//   /* ------------------------------------------------------------
//      Initialisation
//   ------------------------------------------------------------ */

//   function initCatalog() {

//     ensureInstagramSyncButton();

//     /*
//       Give the existing dashboard a moment to finish
//       rendering its HTML before loading products.
//     */

//     setTimeout(() => {

//       ensureInstagramSyncButton();

//       loadCatalogView();

//     }, 300);
//   }

//   if (
//     document.readyState ===
//     'loading'
//   ) {

//     document.addEventListener(
//       'DOMContentLoaded',
//       initCatalog
//     );

//   } else {

//     initCatalog();

//   }

// })();