// @vitest-environment jsdom
/**
 * tests/export-modal.test.tsx — closing the dashboard's export modal
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExportModal } from '../src/components/dashboard/ExportModal';

function renderModal(isOpen = true) {
  const onClose = vi.fn();
  const view = render(
    <ExportModal
      isOpen={isOpen}
      exportFormat="xlsx"
      exporting={false}
      onFormatChange={() => {}}
      onExport={() => {}}
      onClose={onClose}
    />
  );
  return { onClose, ...view };
}

afterEach(cleanup);

describe('ExportModal', () => {
  it('closes on Escape even when focus is outside the modal', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while closed', () => {
    const { onClose } = renderModal(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    const { onClose, container } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[aria-hidden="true"]') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
