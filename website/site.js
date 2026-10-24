document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
      document.getElementById('copy-status').textContent = 'Commands copied to clipboard.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Select & copy';
      document.getElementById('copy-status').textContent = 'Commands selected. Press Command C or Control C to copy.';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 2500);
  });
});
