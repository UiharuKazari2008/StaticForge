// Modal utility functions

function openModal(modal) {
    if (!modal) return;
    // Remove hidden class to show modal
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeModal(modal) {
    if (!modal) return;
    // Add hidden class to hide modal
    modal.classList.add('hidden');
    // Only remove modal-open if no other modals (excluding the current one) are open
    const openModals = Array.from(document.querySelectorAll('.modal')).filter(m => m !== modal);
    const anyOpen = openModals.some(m => !m.classList.contains('hidden'))
    if (!anyOpen) {
        document.body.classList.remove('modal-open');
    }
} 