const state = {
  token: localStorage.getItem("authy-vault-token") || "",
  unlocked: false,
  accounts: [],
};

const elements = {
  vaultModified: document.getElementById("vault-modified"),
  securityIndicator: document.getElementById("security-indicator"),
  headerAccountCount: document.getElementById("header-account-count"),
  totalAccounts: document.getElementById("total-accounts"),
  activeCodes: document.getElementById("active-codes"),
  accountsList: document.getElementById("accounts-list"),
  vaultAccessPanel: document.getElementById("vault-access-panel"),
  createVaultForm: document.getElementById("create-vault-form"),
  createVaultPanel: document.getElementById("create-vault-panel"),
  unlockForm: document.getElementById("unlock-form"),
  unlockPanel: document.getElementById("unlock-panel"),
  createAccountForm: document.getElementById("create-account-form"),
  importForm: document.getElementById("import-form"),
  lockBtn: document.getElementById("lock-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  generateSecretBtn: document.getElementById("generate-secret-btn"),
  createPassword: document.getElementById("create-password"),
  unlockPassword: document.getElementById("unlock-password"),
  importPanel: document.getElementById("import-panel"),
  addAccountPanel: document.getElementById("add-account-panel"),
  deleteModal: document.getElementById("delete-confirmation"),
  deleteModalText: document.getElementById("delete-confirmation-text"),
  cancelDeleteBtn: document.getElementById("cancel-delete-btn"),
  confirmDeleteBtn: document.getElementById("confirm-delete-btn"),
  vaultModeButtons: document.querySelectorAll(".mode-toggle"),
};

const toastTimer = { id: null };
let timerInterval = null;
let pendingDeleteId = null;
let sessionRefreshScheduled = false;

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  if (toastTimer.id) clearTimeout(toastTimer.id);
  toastTimer.id = setTimeout(() => toast.classList.remove("show"), 2600);
}

function handleSessionExpired(message) {
  const text = String(message || "").toLowerCase();
  const shouldReload = text.includes("session") || text.includes("locked") || text.includes("expired") || text.includes("invalid") || text.includes("unauthorized");

  if (!shouldReload || sessionRefreshScheduled) return false;

  sessionRefreshScheduled = true;
  setToken("");
  setUnlockedState(false);
  if (elements.vaultModified) {
    elements.vaultModified.textContent = "Session expired or vault is locked";
  }
  renderAccounts([]);
  showToast(message || "Session expired. Refreshing...", true);

  setTimeout(() => {
    window.location.reload();
  }, 900);

  return true;
}

function closeDeleteConfirmation() {
  pendingDeleteId = null;
  elements.deleteModal.classList.add("hidden");
}

function openDeleteConfirmation(accountId, accountName) {
  pendingDeleteId = accountId;
  const label = accountName || "this account";
  elements.deleteModalText.textContent = `This will permanently remove ${label} from your vault.`;
  elements.deleteModal.classList.remove("hidden");
  elements.confirmDeleteBtn.focus();
}

function setToken(token) {
  state.token = token || "";
  if (state.token) {
    localStorage.setItem("authy-vault-token", state.token);
  } else {
    localStorage.removeItem("authy-vault-token");
  }
}

function setVaultMode(mode) {
  const currentMode = mode === "create" ? "create" : "unlock";
  const isCreate = currentMode === "create";

  elements.createVaultPanel.classList.toggle("hidden", !isCreate);
  elements.unlockPanel.classList.toggle("hidden", isCreate);
  elements.vaultModeButtons.forEach((button) => {
    const active = button.dataset.vaultMode === currentMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setUnlockedState(unlocked) {
  state.unlocked = unlocked;
  const locked = !unlocked;

  if (elements.securityIndicator) {
    elements.securityIndicator.textContent = unlocked ? "Vault unlocked" : "Vault locked";
    elements.securityIndicator.className = `status-pill ${unlocked ? "success" : "neutral"}`;
  }

  elements.vaultAccessPanel.classList.toggle("hidden", unlocked);
  elements.importPanel.classList.toggle("hidden", locked);
  elements.addAccountPanel.classList.toggle("hidden", locked);
  elements.lockBtn.classList.toggle("hidden", locked);

  if (locked) {
    setVaultMode("unlock");
  }
}

async function apiRequest(url, options = {}) {
  const requestOptions = { ...options };
  const headers = { ...(requestOptions.headers || {}) };

  if (!(requestOptions.body instanceof FormData) && !headers["Content-Type"] && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  requestOptions.headers = headers;
  const response = await fetch(url, requestOptions);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return payload?.data ?? payload ?? null;
}

function formatCode(code) {
  const value = String(code || "").replace(/\s/g, "");
  if (value.length === 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  if (value.length === 8) return `${value.slice(0, 4)} ${value.slice(4)}`;
  return value || "-- --";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderAccounts(accounts) {
  state.accounts = accounts || [];
  if (elements.headerAccountCount) {
    elements.headerAccountCount.textContent = `${state.accounts.length} account${state.accounts.length === 1 ? "" : "s"}`;
  }
  if (elements.totalAccounts) {
    elements.totalAccounts.textContent = String(state.accounts.length);
  }
  const activeCodes = state.accounts.filter((account) => typeof account.code === "string").length;
  if (elements.activeCodes) {
    elements.activeCodes.textContent = String(activeCodes);
  }

  if (!state.accounts.length) {
    elements.accountsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">+</div>
        <strong>No accounts yet</strong>
        <p>Unlock your vault and add your first authenticator.</p>
      </div>
    `;
    return;
  }

  elements.accountsList.innerHTML = state.accounts
    .map((account) => {
      const remaining = Number(account.remainingSeconds ?? 0);
      const period = Number(account.period ?? 30);
      const progress = Math.max(0, Math.min(100, (remaining / period) * 100));
      const code = formatCode(account.code || "-- --");
      const urgent = remaining <= 5;

      return `
        <article class="account-card" data-id="${escapeHtml(account.id)}" data-urgent="${urgent}">
          <div class="account-top">
            <div class="account-meta">
              <p class="account-issuer">${escapeHtml(account.issuer || "Unknown")}</p>
              <p class="account-name">${escapeHtml(account.accountName || account.account || "No account name")}</p>
            </div>
            <button type="button" class="ghost-btn" data-action="delete" data-id="${escapeHtml(account.id)}" title="Delete account">Delete</button>
          </div>

          <button type="button" class="account-code" data-action="copy" data-id="${escapeHtml(account.id)}" title="Copy code">${escapeHtml(code)}</button>

          <div class="account-details">
            <span>Expires in <strong class="countdown" data-id="${escapeHtml(account.id)}">${remaining}s</strong></span>
            <span>Next: ${escapeHtml(formatCode(account.nextCode || "-- --"))}</span>
          </div>

          <div class="timer" aria-hidden="true">
            <div class="timer-fill" data-timer-id="${escapeHtml(account.id)}" style="width: ${progress}%"></div>
          </div>

        </article>
      `;
    })
    .join("");

  elements.accountsList.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const target = event.currentTarget;
      const action = target.getAttribute("data-action");
      const id = target.getAttribute("data-id");
      if (!id || !action) return;

      if (action === "delete") {
        const account = state.accounts.find((item) => item.id === id);
        const accountLabel = account?.accountName || account?.issuer || "this account";
        openDeleteConfirmation(id, accountLabel);
        return;
      }

      if (action === "refresh") {
        try {
          const result = await apiRequest(`/api/totp/${id}/code`);
          await refreshAccounts();
          if (result?.code) {
            showToast(`Code refreshed: ${formatCode(result.code)}`);
          }
        } catch (error) {
          showToast(error.message, true);
        }
        return;
      }

      if (action === "copy") {
        const account = state.accounts.find((item) => item.id === id);
        if (!account?.code) return;

        try {
          await navigator.clipboard.writeText(account.code);
          showToast("Code copied");
        } catch {
          showToast("Copy failed", true);
        }
      }
    });
  });
}

function startCodeTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!state.unlocked || !state.accounts.length) return;

    let shouldRefresh = false;

    state.accounts.forEach((account) => {
      const countdown = document.querySelector(`.countdown[data-id="${account.id}"]`);
      const timerBar = document.querySelector(`[data-timer-id="${account.id}"]`);

      if (!countdown || !timerBar) return;

      let remaining = Number(account.remainingSeconds ?? 0);
      remaining = Math.max(0, remaining - 1);
      account.remainingSeconds = remaining;

      countdown.textContent = `${remaining}s`;

      const period = Number(account.period ?? 30);
      const percentage = Math.max(0, Math.min(100, (remaining / period) * 100));
      timerBar.style.width = `${percentage}%`;

      const urgent = remaining <= 5;
      const card = timerBar.closest(".account-card");
      if (card) {
        card.dataset.urgent = String(urgent);
      }

      if (remaining <= 0) shouldRefresh = true;
    });

    if (shouldRefresh) {
      refreshAccounts();
    }
  }, 1000);
}

async function refreshVaultStatus() {
  try {
    if (!state.token) {
      setUnlockedState(false);
      if (elements.vaultModified) {
        elements.vaultModified.textContent = "No vault created yet";
      }
      renderAccounts([]);
      return;
    }

    const result = await apiRequest("/api/vault/status");
    const unlocked = Boolean(result?.unlocked);
    setUnlockedState(unlocked);

    if (result?.modifiedAt) {
      const date = new Date(result.modifiedAt);
      if (elements.vaultModified) {
        elements.vaultModified.textContent = `Updated ${date.toLocaleString()}`;
      }
    } else {
      if (elements.vaultModified) {
        elements.vaultModified.textContent = "Vault available";
      }
    }

    if (unlocked) {
      await refreshAccounts();
    }
  } catch (error) {
    const message = error?.message || "Session expired or vault is locked";
    if (handleSessionExpired(message)) {
      return;
    }
    setUnlockedState(false);
    setToken("");
    if (elements.vaultModified) {
      elements.vaultModified.textContent = "Session expired or vault is locked";
    }
    renderAccounts([]);
    showToast(message, true);
  }
}

async function refreshAccounts() {
  if (!state.token) {
    renderAccounts([]);
    return;
  }

  try {
    const result = await apiRequest("/api/totp");
    renderAccounts(Array.isArray(result) ? result : []);
    startCodeTimer();
  } catch (error) {
    const message = error?.message || "Unable to refresh accounts";
    if (handleSessionExpired(message)) {
      return;
    }
    showToast(message, true);
  }
}

async function handleCreateVault(event) {
  event.preventDefault();
  const password = elements.createPassword.value.trim();
  if (!password) return showToast("Please enter a master password", true);

  try {
    await apiRequest("/api/vault", { method: "POST", body: JSON.stringify({ password }) });
    showToast("Vault created");
    elements.createPassword.value = "";

    const unlockResult = await apiRequest("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password }) });
    setToken(unlockResult?.token || "");
    await refreshVaultStatus();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleUnlock(event) {
  event.preventDefault();
  const password = elements.unlockPassword.value.trim();
  if (!password) return showToast("Please enter your vault password", true);

  try {
    const result = await apiRequest("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password }) });
    setToken(result?.token || "");
    elements.unlockPassword.value = "";
    await refreshVaultStatus();
    showToast("Vault unlocked");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleCreateAccount(event) {
  event.preventDefault();
  if (!state.token) return showToast("Unlock the vault first", true);

  const payload = {
    issuer: document.getElementById("issuer").value.trim(),
    accountName: document.getElementById("account-name").value.trim(),
    secret: document.getElementById("secret").value.trim(),
    algorithm: document.getElementById("algorithm").value.toLowerCase(),
    digits: Number(document.getElementById("digits").value),
    period: Number(document.getElementById("period").value),
  };

  try {
    const result = await apiRequest("/api/totp", { method: "POST", body: JSON.stringify(payload) });
    if (result) {
      showToast("Account saved");
    }
    event.target.reset();
    document.getElementById("digits").value = "6";
    document.getElementById("period").value = "30";
    await refreshAccounts();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleImport(event) {
  event.preventDefault();

  if (!state.token) {
    const vaultPassword = document.getElementById("vault-import-password").value.trim();
    if (!vaultPassword) {
      return showToast("Unlock the vault before importing", true);
    }
  }

  const formData = new FormData(event.target);
  const backupPassword = formData.get("backupPassword")?.toString().trim();
  if (!backupPassword) return showToast("Please enter the 2FAS backup password", true);

  try {
    const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
    const response = await fetch("/api/vault/import-2fas", {
      method: "POST",
      body: formData,
      headers,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Import failed (${response.status})`);
    }

    if (payload?.data?.token) setToken(payload.data.token);
    showToast(`Imported ${payload?.data?.imported ?? 0} entries`);
    event.target.reset();
    await refreshVaultStatus();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleGenerateSecret() {
  if (!state.token) return showToast("Unlock the vault first", true);

  try {
    const result = await apiRequest("/api/totp/generate-secret", { method: "POST" });
    const secret = result?.secret || "";
    document.getElementById("secret").value = secret;
    showToast("Secret generated");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleLock() {
  if (!state.token) return;

  try {
    await apiRequest("/api/vault/lock", { method: "POST" });
    setToken("");
    setUnlockedState(false);
    elements.vaultModified.textContent = "Vault locked";
    renderAccounts([]);
    showToast("Vault locked");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleDeleteConfirmation() {
  if (!pendingDeleteId) return;

  try {
    await apiRequest(`/api/totp/${pendingDeleteId}`, { method: "DELETE" });
    closeDeleteConfirmation();
    showToast("Account deleted");
    await refreshAccounts();
  } catch (error) {
    closeDeleteConfirmation();
    showToast(error.message, true);
  }
}

elements.createVaultForm.addEventListener("submit", handleCreateVault);
elements.unlockForm.addEventListener("submit", handleUnlock);
elements.createAccountForm.addEventListener("submit", handleCreateAccount);
elements.importForm.addEventListener("submit", handleImport);
elements.generateSecretBtn.addEventListener("click", handleGenerateSecret);
elements.lockBtn.addEventListener("click", handleLock);
elements.refreshBtn.addEventListener("click", () => refreshVaultStatus());
elements.confirmDeleteBtn.addEventListener("click", handleDeleteConfirmation);
elements.cancelDeleteBtn.addEventListener("click", closeDeleteConfirmation);
elements.deleteModal.addEventListener("click", (event) => {
  if (event.target === elements.deleteModal) {
    closeDeleteConfirmation();
  }
});
elements.vaultModeButtons.forEach((button) => {
  button.addEventListener("click", () => setVaultMode(button.dataset.vaultMode || "unlock"));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.deleteModal.classList.contains("hidden")) {
    closeDeleteConfirmation();
  }
});

setUnlockedState(false);
refreshVaultStatus();
startCodeTimer();
