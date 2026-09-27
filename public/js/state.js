// Judgely State & UI Core Utilities
(function(window) {
  'use strict';

  const state = {
    user: { role: 'visitor' },
    event: null,
    activeEventId: 'evt_01',
    events: [],
    myEvents: [],
    tracks: [],
    projects: [],
    selectedTrack: 'all',
    searchQuery: '',
    currentView: 'public', // 'public', 'login', 'participant', 'judge', 'organizer'
    demoMode: false,
    googleAuth: false,
    googleClientId: '',
    isHostedShell: window.location.hostname.includes('web.app') || window.location.hostname.includes('firebaseapp.com')
  };

  const listeners = [];

  function subscribe(fn) {
    listeners.push(fn);
  }

  function notify() {
    listeners.forEach(fn => fn(state));
  }

  function setState(patch) {
    Object.assign(state, patch);
    notify();
  }

  // Security: Sanitize strings for safe HTML interpolation
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Security: Sanitize user-provided URLs (prevent javascript: or data: URIs)
  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  // Modal Dialog System
  function openModal(title, bodyHtml) {
    const backdrop = document.getElementById('modal-backdrop');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    if (!backdrop || !titleEl || !bodyEl) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    backdrop.style.display = 'flex';
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.style.display = 'none';
      backdrop.setAttribute('aria-hidden', 'true');
    }
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : (type === 'success' ? 'success' : '')}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.state = state;
  window.Judgely.subscribe = subscribe;
  window.Judgely.setState = setState;
  window.Judgely.escapeHtml = escapeHtml;
  window.Judgely.sanitizeUrl = sanitizeUrl;
  window.Judgely.openModal = openModal;
  window.Judgely.closeModal = closeModal;
  window.Judgely.showToast = showToast;
})(window);
