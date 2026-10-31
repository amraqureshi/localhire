// Shared UI components and Logic

// Safe HTML entity escaper to prevent Cross-Site Scripting (XSS)
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
if (typeof window !== 'undefined') {
  window.escapeHTML = escapeHTML;
}

// Renders stars based on a numeric rating (0 to 5)
function renderStars(rating) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating - fullStars >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  let starsHtml = '';
  // SVG for a full star
  for (let i = 0; i < fullStars; i++) {
    starsHtml += `<svg class="icon star-filled" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  }
  // SVG for a half star (simplified to empty for now if no custom half SVG is available, or use full star with different opacity)
  if (hasHalfStar) {
    starsHtml += `<svg class="icon star-filled" viewBox="0 0 24 24" style="opacity: 0.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  }
  // SVG for empty star
  for (let i = 0; i < emptyStars; i++) {
    starsHtml += `<svg class="icon star-empty" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  }

  return `<div class="flex gap-1">${starsHtml}</div>`;
}

// Generate HTML for a Worker Card
function createWorkerCard(worker, relativePath = '') {
  const availabilityText = worker.availability || 'Available Today';
  const isAvailable = availabilityText.includes('Today') || availabilityText.includes('Now');
  const badgeClass = isAvailable ? 'badge-primary' : 'badge';
  const prefix = relativePath === 'index' ? 'pages/' : '';
  const currentUser = window.localHireApp ? window.localHireApp.getCurrentUser() : null;
  const workerId = worker.id || worker._id;
  const isFav = currentUser && currentUser.favorites && currentUser.favorites.includes(workerId);
  const locationText = typeof worker.location === 'string'
    ? worker.location
    : (worker.location && worker.location.address ? worker.location.address : 'Nearby');

  const safeName = escapeHTML(worker.name || 'Worker');
  const safeCategory = escapeHTML(worker.category || 'Professional');
  const safeExperience = escapeHTML(worker.experience || 'Experienced');
  const safeBio = escapeHTML(worker.bio || 'Local professional ready for hire.');
  const safeLocation = escapeHTML(locationText);
  const safeAvatar = worker.avatarUrl ? escapeHTML(worker.avatarUrl) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(worker.name || 'worker')}`;

  return `
    <div class="glass-card flex-col gap-4 animate-fade-in" style="animation-delay: ${Math.random() * 0.2}s">
      <div class="flex items-center gap-4">
        <img src="${safeAvatar}" alt="${safeName}" style="width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--primary); padding: 2px; object-fit: cover; box-shadow: 0 4px 12px rgba(94, 234, 212, 0.2);">
        <div>
          <h3 style="margin-bottom: 0; font-family: 'DM Serif Display', serif; font-size: 1.25rem;">${safeName}</h3>
          <p class="text-muted" style="margin-bottom: 0.35rem; font-size: 0.85rem;">${safeCategory} • ${safeExperience}</p>
          <div class="flex items-center gap-1">
            ${renderStars(worker.rating || 5.0)}
            <span style="font-size: 0.9rem; font-weight: 600; color: var(--warning); margin-left: 0.25rem;">${Number(worker.rating || 5.0)}</span>
            <span class="text-muted" style="font-size: 0.8rem; margin-left: 0.25rem;">(${Number(worker.reviewsCount || 0)})</span>
          </div>
        </div>
      </div>
      
      <div class="flex flex-col gap-2">
        <p style="font-size: 0.9rem; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; flex-grow: 1;">
          ${safeBio}
        </p>
        <div style="font-size: 0.85rem; margin-top: 0.5rem;" class="flex items-center gap-2 text-muted">
          <svg class="icon" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          ${safeLocation}
        </div>
      </div>

      <div class="flex justify-between items-center" style="margin-top: auto; padding-top: 1.25rem; border-top: 1px solid var(--border-light);">
        <div>
           <span style="font-size: 1.35rem; font-weight: 700; color: var(--text-main); font-family: 'DM Serif Display', serif;">₹${Number(worker.hourlyRate || 0)}</span>
           <span class="text-muted" style="font-size: 0.85rem;">/hr</span>
        </div>
        <div class="flex gap-2">
           ${currentUser && currentUser.role === 'Customer' ? `
           <button class="btn btn-outline fav-card-btn" data-worker-id="${escapeHTML(workerId)}" style="padding: 0.5rem; ${isFav ? 'color: var(--danger); border-color: var(--danger);' : ''}" title="Save to Favorites">
                <svg class="icon" viewBox="0 0 24 24" style="${isFav ? 'fill: currentColor; stroke: none;' : ''}"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
           </button>
           ` : ''}
           <a href="${prefix}profile.html?id=${encodeURIComponent(workerId)}" class="btn btn-primary" style="padding: 0.6rem 1.5rem; border-radius: 9999px;">Hire</a>
        </div>
      </div>
    </div>
  `;
}

// Add global listener to handle favorite buttons in cards (since they are generated dynamically)
document.addEventListener('click', (e) => {
  const favBtn = e.target.closest('.fav-card-btn');
  if (favBtn) {
    const workerId = favBtn.getAttribute('data-worker-id');
    const currentUser = window.localHireApp ? window.localHireApp.getCurrentUser() : null;
    if (currentUser && currentUser.role === 'Customer') {
      window.localHireApp.toggleFavorite(currentUser.id, workerId);

      // Fast toggle visually
      const svg = favBtn.querySelector('svg');
      const isNowFav = favBtn.style.color.includes('ef4444');
      if (isNowFav) {
        favBtn.style.color = 'var(--text-main)';
        favBtn.style.borderColor = 'var(--border-light)';
        svg.style.fill = 'none';
        svg.style.stroke = 'currentColor';
      } else {
        favBtn.style.color = '#ef4444';
        favBtn.style.borderColor = '#ef4444';
        svg.style.fill = 'currentColor';
        svg.style.stroke = 'none';
      }
    }
  }
});

// Generate HTML for a Job Card
function createJobCard(job) {
  const locationText = typeof job.location === 'string'
    ? job.location
    : (job.location && job.location.address ? job.location.address : 'Local area');

  const safeTitle = escapeHTML(job.title || 'Untitled Job');
  const safeStatus = escapeHTML(job.status || 'Open');
  const safeUrgency = escapeHTML(job.urgency || '');
  const safeDescription = escapeHTML(job.description || '');
  const safeCustomer = escapeHTML(job.customerName || 'Client');
  const safeLocation = escapeHTML(locationText);
  const safeBudget = escapeHTML(job.budget || 'Flexible');

  return `
    <div class="glass-card flex-col gap-4 animate-fade-in" style="animation-delay: ${Math.random() * 0.2}s">
      <div class="flex justify-between items-start">
        <h4 style="margin: 0; color: var(--primary); font-size: 1.1rem; padding-right: 1rem;">${safeTitle}</h4>
        <div class="flex flex-col gap-1 items-end">
          <span class="badge ${job.status === 'Open' ? 'badge-primary' : ''}" style="white-space: nowrap;">${safeStatus}</span>
          ${safeUrgency ? `<span class="badge" style="background: var(--surface-light); color: var(--text-main); font-size: 0.75rem; border: 1px solid var(--border-light);"><svg class="icon" style="width: 12px; height: 12px; display: inline; margin-right: 4px; vertical-align: text-bottom;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>${safeUrgency}</span>` : ''}
        </div>
      </div>
      
      <p style="font-size: 0.9rem; color: var(--text-muted); margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">
        ${safeDescription}
      </p>

      <div class="flex flex-col gap-2" style="font-size: 0.85rem; padding-top: 0.5rem;">
        <div class="flex items-center gap-2">
          <svg class="icon text-muted" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span>Posted by ${safeCustomer}</span>
        </div>
        <div class="flex items-center gap-2">
          <svg class="icon text-muted" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          <span>${safeLocation}</span>
        </div>
        <div class="flex items-center gap-2">
          <svg class="icon text-muted" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          <span style="font-weight: 600;">Budget: ${safeBudget}</span>
        </div>
      </div>
    </div>
  `;
}

// Render the navbar into a target element
function renderNavbar(targetElementId, currentPath = '') {
  const container = document.getElementById(targetElementId);
  if (!container) return;

  const user = window.localHireApp.getCurrentUser();

  // Determine relative paths for links depending on if we are in index or pages/
  const isIndex = currentPath === 'index';
  const prefix = isIndex ? 'pages/' : '';
  const homeLink = isIndex ? '#' : '../index.html';

  let authContent = `
    <a href="${prefix}auth.html" class="btn btn-outline" style="padding: 0.5rem 1rem;">Sign In</a>
  `;

  if (user) {
    const userName = (user.name || user.email || 'User').trim();
    const userRole = user.role || 'Customer';
    const firstInitial = userName.charAt(0).toUpperCase();

    authContent = `
      <div class="flex items-center gap-3">
        <div style="text-align: right; line-height: 1.2;">
          <strong style="display: block; font-size: 0.9rem;">${userName}</strong>
          <span class="text-muted" style="font-size: 0.75rem;">${userRole}</span>
        </div>
        ${user.avatarUrl
        ? `<img src="${escapeHTML(user.avatarUrl)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary);">`
        : `<div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold;">${firstInitial}</div>`
      }
        <button onclick="window.handleLogout()" class="btn btn-outline" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; margin-left: 0.5rem;">Logout</button>
      </div>
    `;
  }

  container.innerHTML = `
    <nav class="navbar relative" style="z-index: 50;">
      <div class="container flex justify-between items-center" style="padding: 1rem 1.5rem;">
        <a href="${homeLink}" class="nav-brand flex items-center gap-2" style="text-decoration: none;">
          <svg class="icon" style="color: var(--primary); width: 28px; height: 28px;" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span class="text-gradient font-bold" style="font-size: 1.25rem;">LocalHire</span>
        </a>
        
        <div class="nav-links flex gap-6 hidden md-flex">
          ${(!user || user.role !== 'Worker') ? `<a href="${prefix}search.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">Find Workers</a>` : ''}
          ${user && user.role === 'Worker' ? `<a href="${prefix}jobs.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">Find Work</a>` : ''}
          ${user && user.role === 'Customer' ? `<a href="${prefix}post-job.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">Post a Job</a>` : ''}
          ${user ? `<a href="${prefix}my-jobs.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">Dashboard</a>` : ''}
          ${user ? `<a href="${prefix}chat.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">Messages</a>` : ''}
          ${user && user.role === 'Worker' ? `<a href="${prefix}edit-profile.html" style="text-decoration: none; color: var(--text-color); font-weight: 500;">My Profile</a>` : ''}
          ${user && user.role === 'Admin' ? `<a href="${prefix}admin.html" style="text-decoration: none; color: var(--primary); font-weight: 600;">Admin</a>` : ''}
        </div>
        
        <div class="flex items-center gap-4">
          ${authContent}
        </div>
      </div>
    </nav>
  `;
}

window.handleLogout = function () {
  if (window.localHireApp && typeof window.localHireApp.logoutUser === 'function') {
    window.localHireApp.logoutUser();
  }

  const sessionStore = window.sessionStorage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const localStore = window.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);

  if (sessionStore) {
    sessionStore.removeItem('localHire_token');
    sessionStore.removeItem('localHire_session');
  }
  if (localStore) {
    localStore.removeItem('localHire_token');
    localStore.removeItem('localHire_session');
  }

  window.location.href = window.location.pathname.includes('pages/') ? '../index.html' : 'index.html';
};
