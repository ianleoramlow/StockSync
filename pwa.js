(() => {
  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  const isMobile = window.matchMedia("(max-width: 820px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  let installPrompt = null;
  let installButton = null;
  let iosPanel = null;

  if (isHttp && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js?v=20260625-storage-quota-fix").catch(() => null);
    });
  }

  if (!isMobile || isStandalone) return;

  function ensureInstallButton() {
    if (sessionStorage.getItem("stocksync-install-hidden") === "1") return;
    if (installButton) return;

    installButton = document.createElement("button");
    installButton.type = "button";
    installButton.className = "pwa-install-button";
    installButton.innerHTML = '<span class="pwa-install-icon" aria-hidden="true">+</span><span>Instalar app</span>';
    installButton.addEventListener("click", handleInstallClick);
    document.body.appendChild(installButton);
  }

  function hideInstallButton() {
    if (installButton) installButton.remove();
    installButton = null;
  }

  function showIosInstructions() {
    if (iosPanel) return;

    iosPanel = document.createElement("div");
    iosPanel.className = "pwa-install-panel";
    iosPanel.innerHTML = [
      '<div>',
      '<strong>Abrir como aplicativo</strong>',
      '<p>No iPhone, toque em Compartilhar e depois em Adicionar \u00e0 Tela de In\u00edcio.</p>',
      '</div>',
      '<button type="button" aria-label="Fechar">OK</button>'
    ].join("");
    iosPanel.querySelector("button").addEventListener("click", () => {
      sessionStorage.setItem("stocksync-install-hidden", "1");
      iosPanel.remove();
      iosPanel = null;
      hideInstallButton();
    });
    document.body.appendChild(iosPanel);
  }

  async function handleInstallClick() {
    if (!installPrompt) {
      showIosInstructions();
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    hideInstallButton();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    ensureInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    sessionStorage.setItem("stocksync-install-hidden", "1");
    hideInstallButton();
  });

  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.addEventListener("load", () => setTimeout(ensureInstallButton, 1200));
  }
})();
