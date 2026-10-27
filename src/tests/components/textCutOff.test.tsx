import { afterEach, describe, expect, test, vi } from 'vitest';

import { isCutOff } from '../../components/common/textCutOff';

// KAN-825. When a title can't be read to its end. jsdom has no layout, so each
// test says where the box and the text sit and what the browser would hit.

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// A row: the title, and beside it whatever the test draws over its end.
function row(over = '') {
  document.body.innerHTML = `<div id="row"><span id="title">Reading for the weekend trip to Bergen</span>${over}</div>`;
  const title = document.getElementById('title');
  if (title === null) throw new Error('no title');
  return title;
}

function layOut(
  holder: Element,
  {
    textRight = 190,
    boxRight = 210,
    hit,
  }: { textRight?: number; boxRight?: number; hit: Element | null }
) {
  vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 0, boxRight - 10, 20)
  );
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 0, textRight - 10, 20)
  );
  return vi.spyOn(document, 'elementFromPoint').mockReturnValue(hit);
}

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el;
};

describe('isCutOff', () => {
  test('clipped text is cut off', () => {
    const title = row();
    Object.defineProperty(title, 'scrollWidth', { value: 300 });
    Object.defineProperty(title, 'clientWidth', { value: 200 });
    layOut(title, { hit: title });
    expect(isCutOff(title)).toBe(true);
  });

  test('the hit point is 2px inside the visible end, at the middle', () => {
    const title = row();
    const hitTest = layOut(title, {
      textRight: 190,
      boxRight: 210,
      hit: title,
    });
    isCutOff(title);
    expect(hitTest).toHaveBeenLastCalledWith(188, 10);

    vi.restoreAllMocks();
    const again = layOut(title, { textRight: 260, boxRight: 210, hit: title });
    isCutOff(title);
    expect(again).toHaveBeenLastCalledWith(208, 10);
  });

  test('a hit inside the holder is not covered', () => {
    document.body.innerHTML =
      '<div><span id="title"><b id="inner">Reading</b> for the weekend</span></div>';
    const title = byId('title');
    layOut(title, { hit: byId('inner') });
    expect(isCutOff(title)).toBe(false);
  });

  test('no layout: a zero-width text extent is not covered and hit-tests nothing', () => {
    const title = row();
    const hitTest = layOut(title, { textRight: 10, hit: null });
    expect(isCutOff(title)).toBe(false);
    expect(hitTest).not.toHaveBeenCalled();
  });

  test("a holder's extent is its text, not the boxes it holds", () => {
    document.body.innerHTML =
      '<div id="row"><button id="title"><div id="wide"><span>Short page</span></div></button><div id="strip" style="background-color: rgb(240, 240, 240)"></div></div>';
    const title = byId('title');
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 0, 770, 20)
    );
    // A range over an element spans the boxes it holds (the wide div runs to the row's end); over a text node, the glyphs.
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Range) {
        return this.startContainer.nodeType === Node.TEXT_NODE
          ? new DOMRect(10, 0, 74, 20)
          : new DOMRect(10, 0, 766, 20);
      }
    );
    const hitTest = vi
      .spyOn(document, 'elementFromPoint')
      .mockImplementation((x) => (x > 700 ? byId('strip') : byId('wide')));
    expect(isCutOff(title)).toBe(false);
    expect(hitTest).toHaveBeenLastCalledWith(82, 10);
  });

  test('a null hit is cut off', () => {
    const title = row();
    layOut(title, { hit: null });
    expect(isCutOff(title)).toBe(true);
  });

  test('an opaque background over the end covers', () => {
    const title = row(
      '<div id="over" style="background-color: rgb(240, 240, 240)"></div>'
    );
    layOut(title, { hit: byId('over') });
    expect(isCutOff(title)).toBe(true);
  });

  test('a strip at rest does not cover', () => {
    const title = row(
      '<div id="strip"><span id="icon" style="opacity: 0">delete</span></div>'
    );
    layOut(title, { hit: byId('icon') });
    expect(isCutOff(title)).toBe(false);
  });

  test('a revealed backing covers while its icon is still at opacity 0', () => {
    const title = row(
      '<div id="strip" style="background-color: rgb(240, 240, 240)"><span id="icon" style="opacity: 0">delete</span></div>'
    );
    layOut(title, { hit: byId('icon') });
    expect(isCutOff(title)).toBe(true);
  });

  test('a visible glyph covers', () => {
    const title = row('<div id="strip"><span id="icon">delete</span></div>');
    layOut(title, { hit: byId('icon') });
    expect(isCutOff(title)).toBe(true);
  });

  test('a visible svg covers', () => {
    const title = row(
      '<div id="strip"><svg id="icon"><path id="path" d="M0 0h1"></path></svg></div>'
    );
    layOut(title, { hit: byId('path') });
    expect(isCutOff(title)).toBe(true);
  });

  test('an empty transparent box does not cover', () => {
    const title = row('<div id="strip"><span>delete</span></div>');
    layOut(title, { hit: byId('strip') });
    expect(isCutOff(title)).toBe(false);
  });

  test('a see-through dim does not cover', () => {
    const title = row(
      '<div id="dim" style="background-color: rgba(0, 0, 0, 0.2)"></div>'
    );
    layOut(title, { hit: byId('dim') });
    expect(isCutOff(title)).toBe(false);
  });

  test('a background-image covers', () => {
    const title = row(
      '<div id="fade" style="background-image: linear-gradient(red, blue)"></div>'
    );
    layOut(title, { hit: byId('fade') });
    expect(isCutOff(title)).toBe(true);
  });

  test('a hidden ancestor hides what it holds', () => {
    const title = row(
      '<div style="visibility: hidden"><div id="over" style="background-color: rgb(240, 240, 240)"></div></div>'
    );
    layOut(title, { hit: byId('over') });
    expect(isCutOff(title)).toBe(false);
  });
});
