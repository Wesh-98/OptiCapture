// @vitest-environment jsdom
/**
 * tests/toasts.test.tsx — one toast stack for the whole app
 *
 * Any page or hook can raise a toast through ToastProvider. Done is teal; caution and errors
 * are red. Deleting a scan session from the dashboard asks before it runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../src/context/ToastContext';
import { useToast, type ToastType } from '../src/hooks/useToast';
import { SessionsSection } from '../src/components/dashboard/SessionsSection';

function RaiseToast({ type, message }: Readonly<{ type: ToastType; message: string }>) {
  const { addToast } = useToast();
  return <button onClick={() => addToast(type, message)}>raise</button>;
}

afterEach(cleanup);

describe('ToastProvider', () => {
  it.each([
    ['success', 'Added "Cola"', 'Done', 'text-brand-600'],
    ['warning', 'Please add a UPC', 'Caution', 'text-accent-600'],
    ['error', 'Failed to delete item', 'Error', 'text-accent-600'],
  ] as const)('shows a %s toast with its icon colour', (type, message, label, tone) => {
    render(
      <ToastProvider>
        <RaiseToast type={type} message={message} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('raise'));

    expect(screen.getByRole('status').textContent).toContain(message);
    expect(screen.getByLabelText(label).closest('div')?.className).toContain(tone);
  });
});

describe('SessionsSection delete', () => {
  it('asks before deleting a session', () => {
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <SessionsSection
          sessions={[
            {
              session_id: 'abc',
              status: 'draft',
              item_count: 3,
              created_at: new Date().toISOString(),
            } as never,
          ]}
          isOpen
          now={Date.now()}
          onToggle={() => {}}
          onDelete={onDelete}
          onNewScan={() => {}}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTitle('Delete session'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Delete session'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('abc');
  });
});
