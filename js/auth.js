// ===== MODO Nexo — Autenticação Firebase =====

let _currentUser = null;
let _userProfile = null;

function isAdmin(email) {
  return CONFIG.adminEmails.includes(email);
}

async function initAuth(onUser, onNoUser) {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      _currentUser = user;
      _userProfile = {
        uid:   user.uid,
        email: user.email,
        nome:  user.displayName || user.email.split("@")[0],
        admin: isAdmin(user.email),
      };
      if (onUser) onUser(_userProfile);
    } else {
      _currentUser = null;
      _userProfile = null;
      if (onNoUser) onNoUser();
    }
  });
}

function getCurrentUser() { return _userProfile; }

async function getIdToken() {
  if (!_currentUser) return null;
  return _currentUser.getIdToken(true); // forceRefresh — renova automaticamente
}

async function login(email, password) {
  return firebase.auth().signInWithEmailAndPassword(email, password);
}

async function logout() {
  await firebase.auth().signOut();
  window.location.href = "/index.html";
}

async function sendPasswordReset(email) {
  return firebase.auth().sendPasswordResetEmail(email);
}

// Redireciona para login se não autenticado
function requireAuth(adminOnly = false) {
  return new Promise((resolve) => {
    initAuth(
      (profile) => {
        if (adminOnly && !profile.admin) {
          window.location.href = "/parceiro/dashboard.html";
          return;
        }
        resolve(profile);
      },
      () => {
        window.location.href = "/index.html";
      }
    );
  });
}

// Renderiza avatar e nome do usuário na sidebar
function renderUserChip(profile) {
  const inicial = (profile.nome || profile.email || "U")[0].toUpperCase();
  const elAvatar = document.querySelector(".user-avatar");
  const elNome   = document.querySelector(".user-name");
  const elRole   = document.querySelector(".user-role");
  if (elAvatar) elAvatar.textContent = inicial;
  if (elNome)   elNome.textContent   = profile.nome || profile.email;
  if (elRole)   elRole.textContent   = profile.admin ? "Admin / Gestor" : "Parceiro";
}

// Marca item ativo na nav
function setActiveNav(href) {
  document.querySelectorAll(".nav-item, .bottom-nav-item").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("href") === href || el.dataset.page === href);
  });
}
