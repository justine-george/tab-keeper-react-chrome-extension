// The vertical space a group's band keeps from the rows around it. Named
// because three places have to agree on it: the band's own style, the
// GroupFrameFollower that trades margin for padding while a preview grows the
// band and has to hand back exactly the margin it borrowed, and the tab drag's
// rules, which tell the engine what gap a band's neighbours keep once a drop
// removes it (KAN-169).

// Above and below every band.
export const BAND_MARGIN_PX = 2;

// KAN-179. The gap a band opens when the row above it is ANOTHER GROUP.
//
// A band means "release here and join this group" over its whole height
// (KAN-164), so between two adjacent groups the only ungrouped landing is the
// gap between the two bands -- and adjacent margins COLLAPSE, so two 2px
// margins leave 2px, not 4. Reported from the real popup as a target that had
// to be finagled.
//
// Spent on the TOP margin of the lower band, never the bottom of the upper
// one: footprintOf reads a row's own margin-BOTTOM and hands it to the preview
// as the distance every displaced row travels (KAN-163/167), so a wider bottom
// margin would move every preview in the pane. A top margin moves nothing but
// the band it sits on.
export const ADJACENT_GROUP_GAP_PX = 8;
