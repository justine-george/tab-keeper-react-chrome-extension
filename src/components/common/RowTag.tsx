import { RADIUS, ROW_TAG } from '../../styles/scale';
import { Tag } from './Tag';

// KAN-720. A row's tag: rounded, roomier than the "/" hint's Tag, and never squeezed.
const rowTagStyle = `
  border-radius: ${RADIUS.TAG};
  corner-shape: ${ROW_TAG.CORNER_SHAPE};
  padding: ${ROW_TAG.PADDING};
  margin-left: 8px;
  flex-shrink: 0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`;

export const RowTag: React.FC<{ value: string }> = ({ value }) => (
  <Tag value={value} style={rowTagStyle} data-row-tag="" />
);
