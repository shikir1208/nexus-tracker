document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  try {
    const check = await fetch('/api/auth/check');
    const data = await check.json();
    if (data.authenticated) {
      window.location.href = '/';
    }
  } catch {
    // Server unavailable — stay on login page
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        errorEl.textContent = payload.error || 'Login failed. Please try again.';
        return;
      }

      window.location.href = '/';
    } catch {
      errorEl.textContent = 'Could not reach the server. Try again later.';
    }
  });
});
