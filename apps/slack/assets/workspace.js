if (new URLSearchParams(location.search).has('rail')) document.body.classList.add('rail-only')
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
  document.getElementById('error').hidden = true
  window.workspace?.open(button.dataset.open)
}))
window.workspace?.state(({ active }) => {
  document.querySelectorAll('[data-open]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.open === active)))
  const close = document.getElementById('close-tab')
  close.hidden = active === 'chat'
  close.dataset.open = 'close-' + active
  close.setAttribute('aria-label', (active === 'approvals' ? '전자결재' : '업무') + ' 탭 닫기')
  document.querySelector('aside').hidden = active === 'chat'
  document.querySelector('main').hidden = true
})
window.workspace?.error(() => { document.getElementById('error').hidden = false })
