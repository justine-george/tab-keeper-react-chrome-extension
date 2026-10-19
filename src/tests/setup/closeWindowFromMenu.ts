import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// KAN-696. Close window is the last item of an Open now window's ⋮ (it was an
// inline ×), named by the window as the other strip controls are.
export async function closeWindowFromMenu(windowName: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: `More actions: ${windowName}` })
  );
  await user.click(
    within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Close window',
    })
  );
}
