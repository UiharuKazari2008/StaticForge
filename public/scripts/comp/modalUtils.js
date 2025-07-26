// Modal utility functions

function openModal(modal) {
    if (!modal) return;
    // Show modal (block or flex depending on class)
    if (modal.classList.contains('block-modal')) {
        modal.style.display = 'block';
    } else {
        modal.style.display = 'flex';
    }
    document.body.classList.add('modal-open');
}

function closeModal(modal) {
    if (!modal) return;
    modal.style.display = 'none';
    // Only remove modal-open if no other modals (excluding the current one) are open
    const openModals = Array.from(document.querySelectorAll('.modal')).filter(m => m !== modal);
    const anyOpen = openModals.some(m => m.style.display === 'flex');
    if (!anyOpen) {
        document.body.classList.remove('modal-open');
    }
} 