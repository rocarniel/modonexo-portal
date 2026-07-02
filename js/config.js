// ===== MODO Nexo — Configuração =====

const CONFIG = {
  // Firebase (obtenha em console.firebase.google.com)
  firebase: {
    apiKey:            "AIzaSyDjGSDSvXkTZPN2jhxZ2JhGNhsegD9Z_E8",
    authDomain:        "modonexo-d8eff.firebaseapp.com",
    projectId:         "modonexo-d8eff",
  },

  // Cloudflare Worker (obtenha após publicar o worker)
  workerUrl: "https://modonexo-worker.modonexo.workers.dev",

  // Domínio público do portal
  portalUrl: "https://www.modonexo.com.br",

  // E-mails com acesso admin/gestor
  adminEmails: [
    "rocarniel@gmail.com",
    "olegarioadvogado@gmail.com",
  ],

  // Limites de arquivo
  limits: {
    imagemMB:    10,
    documentoMB: 20,
    videoMB:     50,
  },
};
