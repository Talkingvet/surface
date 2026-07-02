/** px → rem, so text responds to the font-size setting (root font-size). */
export const fs = (px: number): string => `${px / 16}rem`;
