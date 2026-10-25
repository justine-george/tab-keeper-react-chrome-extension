import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import Button from '../../components/common/Button';
import ClickableRow from '../../components/common/ClickableRow';
import GroupColorPicker from '../../components/common/GroupColorPicker';
import Icon from '../../components/common/Icon';
import SlidingPair from '../../components/common/SlidingPair';
import OpenNowRail from '../../components/home/opennow/OpenNowRail';
import { renderWithProviders } from '../setup/renderWithProviders';

// KAN-345. A tooltip equal to the name is not announced twice. KAN-695: the
// tooltip is data-tooltip, so the description is stated outright: the tooltip
// when it adds something, no attribute at all when it repeats the name.
describe('an Icon is not described by its own name', () => {
  const noop = () => {};

  test('a tooltip that adds something stays the description', async () => {
    await renderWithProviders(
      <Icon
        type="reopen_window"
        onClick={noop}
        ariaLabel="Open"
        tooltipText="Open session"
      />
    );
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute(
      'aria-description',
      'Open session'
    );
  });

  test('an explicit description wins', async () => {
    await renderWithProviders(
      <Icon
        type="sync"
        onClick={noop}
        ariaLabel="Sync now"
        tooltipText="Sync now"
        ariaDescription="Sync is off"
      />
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveAttribute(
      'aria-description',
      'Sync is off'
    );
  });

  test('a decoration carries none', async () => {
    const { container } = await renderWithProviders(<Icon type="web_asset" />);
    expect(container.querySelector('[aria-description]')).toBeNull();
  });
});

describe('the other controls with a tooltip follow the same rule', () => {
  const noop = () => {};

  test('a row whose tooltip is its name: no description', async () => {
    await renderWithProviders(
      <ClickableRow ariaLabel="Search" tooltipText="Search" onClick={noop}>
        Tab Keeper
      </ClickableRow>
    );
    const row = screen.getByRole('button', { name: 'Search' });
    expect(row).toHaveAttribute('data-tooltip', 'Search');
    expect(row).not.toHaveAttribute('aria-description');
  });

  test('a row whose tooltip adds something: it is the description', async () => {
    await renderWithProviders(
      <ClickableRow
        ariaLabel="Morning reading"
        tooltipText="Open in new window"
        onClick={noop}
      >
        Morning reading
      </ClickableRow>
    );
    expect(
      screen.getByRole('button', { name: 'Morning reading' })
    ).toHaveAttribute('aria-description', 'Open in new window');
  });

  test('a button whose tooltip is its name: no description', async () => {
    await renderWithProviders(
      <Button
        iconType="settings"
        ariaLabel="Settings"
        tooltipText="Settings"
        onClick={noop}
      />
    );
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveAttribute('data-tooltip', 'Settings');
    expect(button).not.toHaveAttribute('aria-description');
  });

  test('a colour band and its swatches: no description', async () => {
    await renderWithProviders(
      <GroupColorPicker color="blue" ariaLabel="Colour: Work" onSelect={noop} />
    );
    const band = screen.getByRole('button', { name: 'Colour: Work' });
    expect(band).toHaveAttribute('data-tooltip', 'Colour: Work');
    expect(band).not.toHaveAttribute('aria-description');
    fireEvent.click(band);
    const blue = screen.getByRole('menuitemradio', { name: 'Blue' });
    expect(blue).toHaveAttribute('data-tooltip', 'Blue');
    expect(blue).not.toHaveAttribute('aria-description');
  });

  test('an icon side of a sliding pair: no description', async () => {
    await renderWithProviders(
      <SlidingPair
        label="Pair"
        options={[
          { value: 'a', label: 'Undo', icon: 'undo' },
          { value: 'b', label: 'Redo' },
        ]}
        value="a"
        onChange={noop}
        metrics={{
          minHeight: '32px',
          radius: '0px',
          knobRadius: '0px',
          slide: '0ms',
          press: '0ms',
        }}
      />
    );
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveAttribute('data-tooltip', 'Undo');
    expect(undo).not.toHaveAttribute('aria-description');
    expect(screen.getByRole('button', { name: 'Redo' })).not.toHaveAttribute(
      'data-tooltip'
    );
  });

  test('the Open now rail button: no description', async () => {
    await renderWithProviders(
      <OpenNowRail
        windows={null}
        foldAction={{ icon: 'undo', label: 'Fold', onClick: noop }}
        buttonRef={createRef()}
        searchText=""
        onSearchTextChange={noop}
        searchInputRef={createRef()}
      />
    );
    const rail = screen.getByRole('button', { name: 'Currently open' });
    expect(rail).toHaveAttribute('data-tooltip', 'Currently open');
    expect(rail).not.toHaveAttribute('aria-description');
  });
});
