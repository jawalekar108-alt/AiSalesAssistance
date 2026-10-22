//13/10

/* ============================================================
 * MY PRODUCTS (added manually, shown in the WhatsApp catalogue)
 * Needs: GET/POST/PUT/DELETE /api/products
 * ============================================================ */

let myProducts = [];
let pfEditingId = null;
let pfImageData = null; // resized JPEG (data URL) chosen in the form
let pfRemoveImage = false;
let pfCatalogMode = false; // true while editing an Instagram product (saved through /api/catalog)

function pfEsc(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pfStoreId() {
  return document.getElementById('catalog-store-filter')?.value || 'clothing';
}

function pfMsg(text, ok = false) {
  const el = document.getElementById('pf-msg');
  if (!el) return;

  el.style.color = ok ? '#34d399' : '#f87171';
  el.textContent = text || '';
}

/* ---------- one place for every request: always gives a clear error ---------- */

async function pfApi(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });

  if (res.redirected && /login/i.test(res.url)) {
    throw new Error('Your session expired. Please log in again.');
  }

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!data) {
    throw new Error(
      `The server sent a web page instead of data (HTTP ${res.status}). Restart the server so /api/products is active, then refresh this page.`
    );
  }

  // your login middleware answers with "message", other routes with "error"
  if (!res.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${res.status}`);

  return data;
}

/* ---------- image: resize in the browser so uploads stay small ---------- */

function pfResize(file, max = 900) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Please choose an image file'));

    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Could not read the file'));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error('This image format is not supported. Use JPG or PNG.'));

      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // PNG transparency becomes white
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/* ---------- "Remove photo" button (created by JS, no HTML change needed) ---------- */

function pfRemoveButton() {
  let button = document.getElementById('pf-remove-image');
  if (button) return button;

  const preview = document.getElementById('pf-preview');
  if (!preview) return null;

  button = document.createElement('button');
  button.type = 'button';
  button.id = 'pf-remove-image';
  button.className = 'btn btn-secondary';
  button.style.cssText = 'display:none;width:auto;margin-top:0.4rem;padding:3px 8px;font-size:0.72rem;';
  button.innerHTML = '<i class="fas fa-trash"></i> Remove photo';
  button.onclick = pfRemovePhoto;

  preview.insertAdjacentElement('afterend', button);
  return button;
}

function pfShowRemoveButton(show) {
  const button = pfRemoveButton();
  if (button) button.style.display = show ? 'inline-flex' : 'none';
}

function pfRemovePhoto() {
  pfImageData = null;
  pfRemoveImage = Boolean(pfEditingId); // tell the server to delete the saved photo

  pfSet('pf-image', '');

  const preview = document.getElementById('pf-preview');
  preview.removeAttribute('src');
  preview.style.display = 'none';

  pfShowRemoveButton(false);
}

async function onProductImagePicked(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    pfImageData = await pfResize(file);
    pfRemoveImage = false;

    const preview = document.getElementById('pf-preview');
    preview.src = pfImageData;
    preview.style.display = 'block';

    pfShowRemoveButton(true);
    pfMsg('');
  } catch (error) {
    pfImageData = null;
    input.value = '';
    pfMsg(error.message);
  }
}

/* ---------- form ---------- */

function pfSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value === null || value === undefined ? '' : value;
}

function openProductForm(product, options) {
  pfCatalogMode = Boolean(options && options.catalog);
  pfEditingId = product ? product.id : null;
  pfImageData = null;
  pfRemoveImage = false;

  const storeLabel = pfStoreId() === 'electronics' ? 'Electronics store' : 'Clothing store';

  document.getElementById('pf-title').textContent = product ? (pfCatalogMode ? 'Edit Instagram product' : 'Edit product') : `Add product — ${storeLabel}`;

  pfSet('pf-name', product?.name);
  pfSet('pf-category', product?.category);
  pfSet('pf-price', product?.price);
  pfSet('pf-original', product && product.original_price !== product.price ? product.original_price : '');
  pfSet('pf-stock', product?.stock);
  pfSet('pf-sizes', (product?.sizes || []).join(', '));
  pfSet('pf-colors', (product?.colors || []).join(', '));
  pfSet('pf-desc', product?.description);
  pfSet('pf-image', '');

  const preview = document.getElementById('pf-preview');

  if (product?.image_url) {
    preview.src = product.image_url;
    preview.style.display = 'block';
    pfShowRemoveButton(true);
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
    pfShowRemoveButton(false);
  }

  // Instagram photos come from Instagram, so the photo box is hidden when editing them
  const photoBox = document.getElementById('pf-image')?.parentElement;
  if (photoBox) photoBox.style.display = pfCatalogMode ? 'none' : '';

  pfMsg('');
  document.getElementById('product-modal').style.display = 'flex';
}

function closeProductForm() {
  document.getElementById('product-modal').style.display = 'none';
}

async function saveProductForm() {
  const button = document.getElementById('pf-save');

  if (pfCatalogMode) return saveCatalogProductForm(button);

  const payload = {
    store_id: pfStoreId(),
    name: document.getElementById('pf-name').value,
    category: document.getElementById('pf-category').value,
    price: document.getElementById('pf-price').value,
    original_price: document.getElementById('pf-original').value,
    stock: document.getElementById('pf-stock').value,
    sizes: document.getElementById('pf-sizes').value,
    colors: document.getElementById('pf-colors').value,
    description: document.getElementById('pf-desc').value
  };

  if (pfImageData) payload.image_data = pfImageData;
  if (pfRemoveImage) payload.remove_image = true;

  button.disabled = true;
  pfMsg('Saving...', true);

  try {
    await pfApi(pfEditingId ? `/api/products/${encodeURIComponent(pfEditingId)}` : '/api/products', {
      method: pfEditingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-store-id': pfStoreId() },
      body: JSON.stringify(payload)
    });

    closeProductForm();
    await loadMyProducts();

    // Refresh the Instagram product table too (function lives in catalog.js)
    if (typeof filterCatalog === 'function') {
      try {
        filterCatalog();
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    pfMsg(error.message);
  } finally {
    button.disabled = false;
  }
}

/* ---------- save an edited Instagram product ---------- */

async function saveCatalogProductForm(button) {
  const text = id => (document.getElementById(id)?.value || '').trim();
  const list = id => text(id).split(',').map(item => item.trim()).filter(Boolean);

  const name = text('pf-name');
  const priceRaw = text('pf-price');
  const price = Number(priceRaw);

  if (!name) return pfMsg('Please type the product name');
  if (priceRaw === '' || !Number.isFinite(price) || price < 0) return pfMsg('Please type a valid price');

  const originalRaw = text('pf-original');
  const stockRaw = text('pf-stock');

  const payload = {
    store_id: pfStoreId(),
    name,
    category: text('pf-category'),
    price,
    original_price: originalRaw === '' ? price : Number(originalRaw),
    stock: stockRaw === '' ? null : Number(stockRaw),
    sizes: list('pf-sizes').map(item => item.toUpperCase()),
    colors: list('pf-colors').map(item => item.toLowerCase()),
    description: text('pf-desc')
  };

  button.disabled = true;
  pfMsg('Saving...', true);

  try {
    await pfApi(`/api/catalog/products/${encodeURIComponent(pfEditingId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-store-id': pfStoreId() },
      body: JSON.stringify(payload)
    });

    closeProductForm();
    await loadMyProducts();

    if (typeof filterCatalog === 'function') filterCatalog();
  } catch (error) {
    pfMsg(error.message);
  } finally {
    button.disabled = false;
  }
}

/* ---------- table ---------- */

function pfFind(id) {
  // ids can be numbers or strings; onclick gives us a string
  return myProducts.find(p => String(p.id) === String(id));
}

function renderMyProducts() {
  const body = document.getElementById('mp-table-body');
  if (!body) return;

  if (!myProducts.length) {
    body.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:#888;">No manual products yet. Click <strong>Add Product</strong> to add your first one — it appears in your WhatsApp catalogue automatically.</td></tr>';
    return;
  }

  body.innerHTML = myProducts
    .map(p => {
      const stock =
        p.stock === null || p.stock === undefined
          ? '<span style="color:#64748b;">Not tracked</span>'
          : Number(p.stock) <= 0
          ? '<span style="color:#f87171;font-weight:700;">Sold out</span>'
          : `${Number(p.stock)}`;

      const image = p.image_url
        ? `<img src="${pfEsc(p.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">`
        : '<div style="width:48px;height:48px;border-radius:8px;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#64748b;"><i class="fas fa-image"></i></div>';

      return `
        <tr>
          <td>
            <div style="display:flex;gap:0.75rem;align-items:center;">
              ${image}
              <div>
                <div style="font-weight:700;color:#fff;">${pfEsc(p.name)}</div>
                <div style="font-size:0.72rem;color:#64748b;">${pfEsc(p.category || '')}</div>
              </div>
            </div>
          </td>
          <td><strong style="color:#34d399;">₹${Number(p.price).toLocaleString('en-IN')}</strong>
            ${Number(p.original_price) > Number(p.price) ? `<div style="font-size:0.7rem;color:#64748b;text-decoration:line-through;">₹${Number(p.original_price).toLocaleString('en-IN')}</div>` : ''}
          </td>
          <td>${stock}</td>
          <td style="font-size:0.78rem;color:#cbd5e1;">
            ${pfEsc((p.sizes || []).join(', ') || '—')}
            <div style="color:#64748b;">${pfEsc((p.colors || []).join(', '))}</div>
          </td>
          <td>
            ${
              p.wa_link
                ? `<button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="copyProductLink('${pfEsc(p.id)}')"><i class="fab fa-whatsapp"></i> Copy link</button>`
                : '<span style="font-size:0.7rem;color:#64748b;">Connect WhatsApp first</span>'
            }
          </td>
          <td>
            <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="editMyProduct('${pfEsc(p.id)}')"><i class="fas fa-pen"></i></button>
            <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;border-color:#ef4444;color:#f87171;" onclick="deleteMyProduct('${pfEsc(p.id)}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
    })
    .join('');
}

async function loadMyProducts() {
  const body = document.getElementById('mp-table-body');
  if (!body) return;

  try {
    const storeId = pfStoreId();

    const data = await pfApi(`/api/products?store_id=${encodeURIComponent(storeId)}`, {
      headers: { 'x-store-id': storeId }
    });

    myProducts = data.products || [];
    renderMyProducts();
  } catch (error) {
    console.error('[Products] Load failed:', error);
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;">Could not load products: ${pfEsc(error.message)}</td></tr>`;
  }
}

function editMyProduct(id) {
  const product = pfFind(id);
  if (product) openProductForm(product);
}

async function deleteMyProduct(id) {
  const product = pfFind(id);
  if (!product) return;

  if (!confirm(`Delete "${product.name}"? It will disappear from your WhatsApp catalogue.`)) return;

  try {
    const storeId = pfStoreId();

    await pfApi(`/api/products/${encodeURIComponent(id)}?store_id=${encodeURIComponent(storeId)}`, {
      method: 'DELETE',
      headers: { 'x-store-id': storeId }
    });

    await loadMyProducts();

    if (typeof filterCatalog === 'function') {
      try {
        filterCatalog();
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    alert(`Could not delete: ${error.message}`);
  }
}

function copyProductLink(id) {
  const product = pfFind(id);
  if (!product?.wa_link) return;

  const done = () => alert('WhatsApp link copied! Share it in your Instagram bio, stories or status. Customers who tap it land on this product.');

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(product.wa_link).then(done, () => prompt('Copy this link:', product.wa_link));
  } else {
    prompt('Copy this link:', product.wa_link);
  }
}

/* ---------- start ---------- */

document.getElementById('catalog-store-filter')?.addEventListener('change', loadMyProducts);
document.querySelector('.tab-btn[data-tab="catalog"]')?.addEventListener('click', loadMyProducts);

loadMyProducts();


//old file
// /* ============================================================
//  * MY PRODUCTS (added manually, shown in the WhatsApp catalogue)
//  * Needs: GET/POST/PUT/DELETE /api/products
//  * ============================================================ */

// let myProducts = [];
// let pfEditingId = null;
// let pfImageData = null; // resized JPEG (data URL) chosen in the form
// let pfRemoveImage = false;

// function pfEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function pfStoreId() {
//   return document.getElementById('catalog-store-filter')?.value || 'clothing';
// }

// function pfMsg(text, ok = false) {
//   const el = document.getElementById('pf-msg');
//   if (!el) return;

//   el.style.color = ok ? '#34d399' : '#f87171';
//   el.textContent = text || '';
// }

// /* ---------- image: resize in the browser so uploads stay small ---------- */

// function pfResize(file, max = 900) {
//   return new Promise((resolve, reject) => {
//     if (!/^image\//.test(file.type)) return reject(new Error('Please choose an image file'));

//     const reader = new FileReader();

//     reader.onerror = () => reject(new Error('Could not read the file'));

//     reader.onload = () => {
//       const img = new Image();

//       img.onerror = () => reject(new Error('This image format is not supported. Use JPG or PNG.'));

//       img.onload = () => {
//         const scale = Math.min(1, max / Math.max(img.width, img.height));
//         const w = Math.max(1, Math.round(img.width * scale));
//         const h = Math.max(1, Math.round(img.height * scale));

//         const canvas = document.createElement('canvas');
//         canvas.width = w;
//         canvas.height = h;

//         const ctx = canvas.getContext('2d');
//         ctx.fillStyle = '#ffffff'; // PNG transparency becomes white
//         ctx.fillRect(0, 0, w, h);
//         ctx.drawImage(img, 0, 0, w, h);

//         resolve(canvas.toDataURL('image/jpeg', 0.82));
//       };

//       img.src = reader.result;
//     };

//     reader.readAsDataURL(file);
//   });
// }

// async function onProductImagePicked(input) {
//   const file = input.files && input.files[0];
//   if (!file) return;

//   try {
//     pfImageData = await pfResize(file);
//     pfRemoveImage = false;

//     const preview = document.getElementById('pf-preview');
//     preview.src = pfImageData;
//     preview.style.display = 'block';

//     pfMsg('');
//   } catch (error) {
//     pfImageData = null;
//     input.value = '';
//     pfMsg(error.message);
//   }
// }

// /* ---------- form ---------- */

// function pfSet(id, value) {
//   const el = document.getElementById(id);
//   if (el) el.value = value === null || value === undefined ? '' : value;
// }

// function openProductForm(product) {
//   pfEditingId = product ? product.id : null;
//   pfImageData = null;
//   pfRemoveImage = false;

//   const storeLabel = pfStoreId() === 'electronics' ? 'Electronics store' : 'Clothing store';

//   document.getElementById('pf-title').textContent = product ? 'Edit product' : `Add product — ${storeLabel}`;

//   pfSet('pf-name', product?.name);
//   pfSet('pf-category', product?.category);
//   pfSet('pf-price', product?.price);
//   pfSet('pf-original', product && product.original_price !== product.price ? product.original_price : '');
//   pfSet('pf-stock', product?.stock);
//   pfSet('pf-sizes', (product?.sizes || []).join(', '));
//   pfSet('pf-colors', (product?.colors || []).join(', '));
//   pfSet('pf-desc', product?.description);
//   pfSet('pf-image', '');

//   const preview = document.getElementById('pf-preview');

//   if (product?.image_url) {
//     preview.src = product.image_url;
//     preview.style.display = 'block';
//   } else {
//     preview.removeAttribute('src');
//     preview.style.display = 'none';
//   }

//   pfMsg('');
//   document.getElementById('product-modal').style.display = 'flex';
// }

// function closeProductForm() {
//   document.getElementById('product-modal').style.display = 'none';
// }

// async function saveProductForm() {
//   const button = document.getElementById('pf-save');

//   const payload = {
//     store_id: pfStoreId(),
//     name: document.getElementById('pf-name').value,
//     category: document.getElementById('pf-category').value,
//     price: document.getElementById('pf-price').value,
//     original_price: document.getElementById('pf-original').value,
//     stock: document.getElementById('pf-stock').value,
//     sizes: document.getElementById('pf-sizes').value,
//     colors: document.getElementById('pf-colors').value,
//     description: document.getElementById('pf-desc').value
//   };

//   if (pfImageData) payload.image_data = pfImageData;
//   if (pfRemoveImage) payload.remove_image = true;

//   button.disabled = true;
//   pfMsg('Saving...', true);

//   try {
//     const res = await fetch(pfEditingId ? `/api/products/${encodeURIComponent(pfEditingId)}` : '/api/products', {
//       method: pfEditingId ? 'PUT' : 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(payload)
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     closeProductForm();
//     await loadMyProducts();

//     // Refresh the Instagram product table too (function lives in catalog.js)
//     if (typeof filterCatalog === 'function') {
//       try {
//         filterCatalog();
//       } catch {
//         /* ignore */
//       }
//     }
//   } catch (error) {
//     pfMsg(error.message);
//   } finally {
//     button.disabled = false;
//   }
// }

// /* ---------- table ---------- */

// function renderMyProducts() {
//   const body = document.getElementById('mp-table-body');
//   if (!body) return;

//   if (!myProducts.length) {
//     body.innerHTML =
//       '<tr><td colspan="6" style="text-align:center;color:#888;">No manual products yet. Click <strong>Add Product</strong> to add your first one — it appears in your WhatsApp catalogue automatically.</td></tr>';
//     return;
//   }

//   body.innerHTML = myProducts
//     .map(p => {
//       const stock =
//         p.stock === null || p.stock === undefined
//           ? '<span style="color:#64748b;">Not tracked</span>'
//           : Number(p.stock) <= 0
//           ? '<span style="color:#f87171;font-weight:700;">Sold out</span>'
//           : `${Number(p.stock)}`;

//       const image = p.image_url
//         ? `<img src="${pfEsc(p.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">`
//         : '<div style="width:48px;height:48px;border-radius:8px;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#64748b;"><i class="fas fa-image"></i></div>';

//       return `
//         <tr>
//           <td>
//             <div style="display:flex;gap:0.75rem;align-items:center;">
//               ${image}
//               <div>
//                 <div style="font-weight:700;color:#fff;">${pfEsc(p.name)}</div>
//                 <div style="font-size:0.72rem;color:#64748b;">${pfEsc(p.category || '')}</div>
//               </div>
//             </div>
//           </td>
//           <td><strong style="color:#34d399;">₹${Number(p.price).toLocaleString('en-IN')}</strong>
//             ${Number(p.original_price) > Number(p.price) ? `<div style="font-size:0.7rem;color:#64748b;text-decoration:line-through;">₹${Number(p.original_price).toLocaleString('en-IN')}</div>` : ''}
//           </td>
//           <td>${stock}</td>
//           <td style="font-size:0.78rem;color:#cbd5e1;">
//             ${pfEsc((p.sizes || []).join(', ') || '—')}
//             <div style="color:#64748b;">${pfEsc((p.colors || []).join(', '))}</div>
//           </td>
//           <td>
//             ${
//               p.wa_link
//                 ? `<button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="copyProductLink('${pfEsc(p.id)}')"><i class="fab fa-whatsapp"></i> Copy link</button>`
//                 : '<span style="font-size:0.7rem;color:#64748b;">Set WhatsApp number first</span>'
//             }
//           </td>
//           <td>
//             <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="editMyProduct('${pfEsc(p.id)}')"><i class="fas fa-pen"></i></button>
//             <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;border-color:#ef4444;color:#f87171;" onclick="deleteMyProduct('${pfEsc(p.id)}')"><i class="fas fa-trash"></i></button>
//           </td>
//         </tr>`;
//     })
//     .join('');
// }

// async function loadMyProducts() {
//   const body = document.getElementById('mp-table-body');
//   if (!body) return;

//   try {
//     const res = await fetch(`/api/products?store_id=${encodeURIComponent(pfStoreId())}`);
//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     myProducts = data.products || [];
//     renderMyProducts();
//   } catch (error) {
//     console.error('[Products] Load failed:', error);
//     body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;">Could not load products: ${pfEsc(error.message)}</td></tr>`;
//   }
// }

// function editMyProduct(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (product) openProductForm(product);
// }

// async function deleteMyProduct(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (!product) return;

//   if (!confirm(`Delete "${product.name}"? It will disappear from your WhatsApp catalogue.`)) return;

//   try {
//     const res = await fetch(`/api/products/${encodeURIComponent(id)}?store_id=${encodeURIComponent(pfStoreId())}`, {
//       method: 'DELETE'
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     await loadMyProducts();

//     if (typeof filterCatalog === 'function') {
//       try {
//         filterCatalog();
//       } catch {
//         /* ignore */
//       }
//     }
//   } catch (error) {
//     alert(`Could not delete: ${error.message}`);
//   }
// }

// function copyProductLink(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (!product?.wa_link) return;

//   const done = () => alert('WhatsApp link copied! Share it in your Instagram bio, stories or status. Customers who tap it land on this product.');

//   if (navigator.clipboard?.writeText) {
//     navigator.clipboard.writeText(product.wa_link).then(done, () => prompt('Copy this link:', product.wa_link));
//   } else {
//     prompt('Copy this link:', product.wa_link);
//   }
// }

// /* ---------- start ---------- */

// document.getElementById('catalog-store-filter')?.addEventListener('change', loadMyProducts);
// document.querySelector('.tab-btn[data-tab="catalog"]')?.addEventListener('click', loadMyProducts);

// loadMyProducts();


// /* ============================================================
//  * MY PRODUCTS (added manually, shown in the WhatsApp catalogue)
//  * Needs: GET/POST/PUT/DELETE /api/products
//  * ============================================================ */

// let myProducts = [];
// let pfEditingId = null;
// let pfImageData = null; // resized JPEG (data URL) chosen in the form
// let pfRemoveImage = false;

// function pfEsc(value) {
//   if (value === null || value === undefined) return '';

//   return String(value)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#039;');
// }

// function pfStoreId() {
//   return document.getElementById('catalog-store-filter')?.value || 'clothing';
// }

// function pfMsg(text, ok = false) {
//   const el = document.getElementById('pf-msg');
//   if (!el) return;

//   el.style.color = ok ? '#34d399' : '#f87171';
//   el.textContent = text || '';
// }

// /* ---------- image: resize in the browser so uploads stay small ---------- */

// function pfResize(file, max = 900) {
//   return new Promise((resolve, reject) => {
//     if (!/^image\//.test(file.type)) return reject(new Error('Please choose an image file'));

//     const reader = new FileReader();

//     reader.onerror = () => reject(new Error('Could not read the file'));

//     reader.onload = () => {
//       const img = new Image();

//       img.onerror = () => reject(new Error('This image format is not supported. Use JPG or PNG.'));

//       img.onload = () => {
//         const scale = Math.min(1, max / Math.max(img.width, img.height));
//         const w = Math.max(1, Math.round(img.width * scale));
//         const h = Math.max(1, Math.round(img.height * scale));

//         const canvas = document.createElement('canvas');
//         canvas.width = w;
//         canvas.height = h;

//         const ctx = canvas.getContext('2d');
//         ctx.fillStyle = '#ffffff'; // PNG transparency becomes white
//         ctx.fillRect(0, 0, w, h);
//         ctx.drawImage(img, 0, 0, w, h);

//         resolve(canvas.toDataURL('image/jpeg', 0.82));
//       };

//       img.src = reader.result;
//     };

//     reader.readAsDataURL(file);
//   });
// }

// async function onProductImagePicked(input) {
//   const file = input.files && input.files[0];
//   if (!file) return;

//   try {
//     pfImageData = await pfResize(file);
//     pfRemoveImage = false;

//     const preview = document.getElementById('pf-preview');
//     preview.src = pfImageData;
//     preview.style.display = 'block';

//     pfMsg('');
//   } catch (error) {
//     pfImageData = null;
//     input.value = '';
//     pfMsg(error.message);
//   }
// }

// /* ---------- form ---------- */

// function pfSet(id, value) {
//   const el = document.getElementById(id);
//   if (el) el.value = value === null || value === undefined ? '' : value;
// }

// function openProductForm(product) {
//   pfEditingId = product ? product.id : null;
//   pfImageData = null;
//   pfRemoveImage = false;

//   const storeLabel = pfStoreId() === 'electronics' ? 'Electronics store' : 'Clothing store';

//   document.getElementById('pf-title').textContent = product ? 'Edit product' : `Add product — ${storeLabel}`;

//   pfSet('pf-name', product?.name);
//   pfSet('pf-category', product?.category);
//   pfSet('pf-price', product?.price);
//   pfSet('pf-original', product && product.original_price !== product.price ? product.original_price : '');
//   pfSet('pf-stock', product?.stock);
//   pfSet('pf-sizes', (product?.sizes || []).join(', '));
//   pfSet('pf-colors', (product?.colors || []).join(', '));
//   pfSet('pf-desc', product?.description);
//   pfSet('pf-image', '');

//   const preview = document.getElementById('pf-preview');

//   if (product?.image_url) {
//     preview.src = product.image_url;
//     preview.style.display = 'block';
//   } else {
//     preview.removeAttribute('src');
//     preview.style.display = 'none';
//   }

//   pfMsg('');
//   document.getElementById('product-modal').style.display = 'flex';
// }

// function closeProductForm() {
//   document.getElementById('product-modal').style.display = 'none';
// }

// async function saveProductForm() {
//   const button = document.getElementById('pf-save');

//   const payload = {
//     store_id: pfStoreId(),
//     name: document.getElementById('pf-name').value,
//     category: document.getElementById('pf-category').value,
//     price: document.getElementById('pf-price').value,
//     original_price: document.getElementById('pf-original').value,
//     stock: document.getElementById('pf-stock').value,
//     sizes: document.getElementById('pf-sizes').value,
//     colors: document.getElementById('pf-colors').value,
//     description: document.getElementById('pf-desc').value
//   };

//   if (pfImageData) payload.image_data = pfImageData;
//   if (pfRemoveImage) payload.remove_image = true;

//   button.disabled = true;
//   pfMsg('Saving...', true);

//   try {
//     const res = await fetch(pfEditingId ? `/api/products/${encodeURIComponent(pfEditingId)}` : '/api/products', {
//       method: pfEditingId ? 'PUT' : 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(payload)
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     closeProductForm();
//     await loadMyProducts();

//     // Refresh the Instagram product table too (function lives in catalog.js)
//     if (typeof filterCatalog === 'function') {
//       try {
//         filterCatalog();
//       } catch {
//         /* ignore */
//       }
//     }
//   } catch (error) {
//     pfMsg(error.message);
//   } finally {
//     button.disabled = false;
//   }
// }

// /* ---------- table ---------- */

// function renderMyProducts() {
//   const body = document.getElementById('mp-table-body');
//   if (!body) return;

//   if (!myProducts.length) {
//     body.innerHTML =
//       '<tr><td colspan="6" style="text-align:center;color:#888;">No manual products yet. Click <strong>Add Product</strong> to add your first one — it appears in your WhatsApp catalogue automatically.</td></tr>';
//     return;
//   }

//   body.innerHTML = myProducts
//     .map(p => {
//       const stock =
//         p.stock === null || p.stock === undefined
//           ? '<span style="color:#64748b;">Not tracked</span>'
//           : Number(p.stock) <= 0
//           ? '<span style="color:#f87171;font-weight:700;">Sold out</span>'
//           : `${Number(p.stock)}`;

//       const image = p.image_url
//         ? `<img src="${pfEsc(p.image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;">`
//         : '<div style="width:48px;height:48px;border-radius:8px;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#64748b;"><i class="fas fa-image"></i></div>';

//       return `
//         <tr>
//           <td>
//             <div style="display:flex;gap:0.75rem;align-items:center;">
//               ${image}
//               <div>
//                 <div style="font-weight:700;color:#fff;">${pfEsc(p.name)}</div>
//                 <div style="font-size:0.72rem;color:#64748b;">${pfEsc(p.category || '')}</div>
//               </div>
//             </div>
//           </td>
//           <td><strong style="color:#34d399;">₹${Number(p.price).toLocaleString('en-IN')}</strong>
//             ${Number(p.original_price) > Number(p.price) ? `<div style="font-size:0.7rem;color:#64748b;text-decoration:line-through;">₹${Number(p.original_price).toLocaleString('en-IN')}</div>` : ''}
//           </td>
//           <td>${stock}</td>
//           <td style="font-size:0.78rem;color:#cbd5e1;">
//             ${pfEsc((p.sizes || []).join(', ') || '—')}
//             <div style="color:#64748b;">${pfEsc((p.colors || []).join(', '))}</div>
//           </td>
//           <td>
//             ${
//               p.wa_link
//                 ? `<button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="copyProductLink('${pfEsc(p.id)}')"><i class="fab fa-whatsapp"></i> Copy link</button>`
//                 : '<span style="font-size:0.7rem;color:#64748b;">Set WhatsApp number first</span>'
//             }
//           </td>
//           <td>
//             <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;" onclick="editMyProduct('${pfEsc(p.id)}')"><i class="fas fa-pen"></i></button>
//             <button class="btn btn-secondary" style="width:auto;padding:3px 8px;font-size:0.72rem;border-color:#ef4444;color:#f87171;" onclick="deleteMyProduct('${pfEsc(p.id)}')"><i class="fas fa-trash"></i></button>
//           </td>
//         </tr>`;
//     })
//     .join('');
// }

// async function loadMyProducts() {
//   const body = document.getElementById('mp-table-body');
//   if (!body) return;

//   try {
//     const res = await fetch(`/api/products?store_id=${encodeURIComponent(pfStoreId())}`);
//     const data = await res.json();

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     myProducts = data.products || [];
//     renderMyProducts();
//   } catch (error) {
//     console.error('[Products] Load failed:', error);
//     body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#f87171;">Could not load products: ${pfEsc(error.message)}</td></tr>`;
//   }
// }

// function editMyProduct(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (product) openProductForm(product);
// }

// async function deleteMyProduct(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (!product) return;

//   if (!confirm(`Delete "${product.name}"? It will disappear from your WhatsApp catalogue.`)) return;

//   try {
//     const res = await fetch(`/api/products/${encodeURIComponent(id)}?store_id=${encodeURIComponent(pfStoreId())}`, {
//       method: 'DELETE'
//     });

//     const data = await res.json().catch(() => ({}));

//     if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

//     await loadMyProducts();

//     if (typeof filterCatalog === 'function') {
//       try {
//         filterCatalog();
//       } catch {
//         /* ignore */
//       }
//     }
//   } catch (error) {
//     alert(`Could not delete: ${error.message}`);
//   }
// }

// function copyProductLink(id) {
//   const product = myProducts.find(p => p.id === id);
//   if (!product?.wa_link) return;

//   const done = () => alert('WhatsApp link copied! Share it in your Instagram bio, stories or status. Customers who tap it land on this product.');

//   if (navigator.clipboard?.writeText) {
//     navigator.clipboard.writeText(product.wa_link).then(done, () => prompt('Copy this link:', product.wa_link));
//   } else {
//     prompt('Copy this link:', product.wa_link);
//   }
// }

// /* ---------- start ---------- */

// document.getElementById('catalog-store-filter')?.addEventListener('change', loadMyProducts);
// document.querySelector('.tab-btn[data-tab="catalog"]')?.addEventListener('click', loadMyProducts);

// loadMyProducts();
