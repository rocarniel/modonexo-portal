// ===== MODO Nexo — Layout helpers =====

function renderSidebar(navItems, activePage) {
  return `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="brand">MODOnexo</div>
        <div class="sub">Oportunidades</div>
      </div>
      <nav class="sidebar-nav">
        ${navItems.map(item => item.divider
          ? `<div class="nav-section-label">${item.label}</div>`
          : `<a href="${item.href}" class="nav-item${activePage === item.href ? ' active' : ''}">
               <span class="icon">${item.icon}</span>${item.label}
               ${item.badge ? `<span class="nav-badge hidden" id="${item.badge}"></span>` : ''}
             </a>`
        ).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar" id="userAvatar">?</div>
          <div class="user-info">
            <div class="user-name" id="userName">—</div>
            <div class="user-role" id="userRole">—</div>
          </div>
          <button class="btn-logout" onclick="logout()" title="Sair">⏻</button>
        </div>
      </div>
    </div>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>`;
}

function renderMobileHeader(title) {
  return `
    <div class="mobile-header">
      <button class="btn-menu" onclick="openSidebar()">☰</button>
      <span class="brand">${title || 'MODOnexo'}</span>
      <div style="width:32px"></div>
    </div>`;
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

const NAV_PARCEIRO = [
  { icon: '🏠', label: 'Dashboard',            href: '/parceiro/dashboard.html' },
  { icon: '➕', label: 'Nova Oportunidade',     href: '/parceiro/nova-oportunidade.html' },
  { icon: '📋', label: 'Minhas Oportunidades',  href: '/parceiro/oportunidades.html' },
  { divider: true, label: 'Comunicação' },
  { icon: '💬', label: 'Mensagens',             href: '/parceiro/mensagens.html', badge: 'badgeMensagens' },
  { icon: '📢', label: 'Avisos',                href: '/parceiro/avisos.html' },
  { icon: '🔍', label: 'Demandas MODO',         href: '/parceiro/demandas.html' },
];

const NAV_ADMIN = [
  { icon: '🗺️', label: 'Mapa',               href: '/admin/mapa.html' },
  { icon: '📋', label: 'Oportunidades',       href: '/admin/oportunidades.html' },
  { divider: true, label: 'Gestão' },
  { icon: '👥', label: 'Parceiros',           href: '/admin/parceiros.html' },
  { icon: '💬', label: 'Mensagens',           href: '/admin/mensagens.html', badge: 'badgeMensagens' },
  { icon: '📢', label: 'Avisos',              href: '/admin/avisos.html' },
  { icon: '🔍', label: 'Demandas',            href: '/admin/demandas.html' },
  { icon: '🎯', label: 'Leads',               href: '/admin/leads.html' },
  { divider: true, label: 'Captação Interna' },
  { icon: '➕', label: 'Nova (MODO)',          href: '/parceiro/nova-oportunidade.html?origem=MODO' },
  { divider: true, label: '' },
  { icon: '📊', label: 'Métricas',            href: '/admin/metricas.html' },
];

function atualizarBadgeChat(count) {
  const el = document.getElementById('badgeMensagens');
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : String(count);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}
