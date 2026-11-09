/**
 * A large, realistic token file for the performance checks (#103): the size a
 * design system's tokens reach, with alias chains up to five deep.
 *
 * - base: 12 hues × 10 steps of color, 16 spacing steps, 8 radii, 6 font
 *   sizes (164 values)
 * - palette: each base color, by hue and step (aliases, level 1)
 * - semantic: color roles and states over the palette, and spacing over base
 * - component: each role and state of 20 components, over semantic roles
 * - theme and brand: two more alias levels over the components, so the
 *   longest chain is five aliases deep
 *
 * The same every time, so measurements compare.
 */

const HUES = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink'
];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const COMPONENTS = [
  'button',
  'input',
  'select',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'card',
  'dialog',
  'toast',
  'badge',
  'tooltip',
  'menu',
  'table',
  'link',
  'avatar',
  'alert',
  'banner',
  'chip',
  'slider'
];
const STATES = ['default', 'hover', 'active', 'focus', 'disabled'];
const ROLES = ['background', 'text', 'border', 'icon'];

type Group = Record<string, unknown>;

const color = (hue: number, step: number) => ({
  $value: {
    colorSpace: 'srgb',
    components: [
      ((hue * 37) % 100) / 100,
      ((step * 7 + hue * 13) % 100) / 100,
      ((hue * 11 + step) % 100) / 100
    ]
  }
});
const dimension = (value: number, unit = 'px') => ({
  $value: { value, unit }
});

/**
 * The token document, about 1000 tokens.
 *
 * @returns {Group} A DTCG 2025.10 document
 */
export const largeTokens = (): Group => {
  const base: Group = {
    color: { $type: 'color' } as Group,
    space: { $type: 'dimension' } as Group,
    radius: { $type: 'dimension' } as Group,
    'font-size': { $type: 'dimension' } as Group
  };

  HUES.forEach((hue, h) => {
    const steps: Group = {};

    STEPS.forEach((step) => (steps[step] = color(h, step)));
    (base.color as Group)[hue] = steps;
  });
  Array.from({ length: 16 }, (_, i) => i).forEach(
    (i) => ((base.space as Group)[i] = dimension(i * 4))
  );
  Array.from({ length: 8 }, (_, i) => i).forEach(
    (i) => ((base.radius as Group)[i] = dimension(i * 2))
  );
  [12, 14, 16, 20, 24, 32].forEach(
    (size, i) => ((base['font-size'] as Group)[i] = dimension(size / 16, 'rem'))
  );

  // The palette: each base color, aliased
  const palette: Group = { $type: 'color' };

  HUES.forEach((hue) => {
    const steps: Group = {};

    STEPS.forEach(
      (step) => (steps[step] = { $value: `{base.color.${hue}.${step}}` })
    );
    palette[hue] = steps;
  });

  // Semantic roles: each hue for each role and state, aliasing the palette
  const semantic: Group = { color: { $type: 'color' } as Group };

  HUES.forEach((hue, h) => {
    const roles: Group = {};

    ROLES.forEach((role, r) => {
      const states: Group = {};

      STATES.forEach((state, s) => {
        states[state] = {
          $value: `{palette.${hue}.${STEPS[(h + r * 2 + s) % STEPS.length]}}`
        };
      });
      roles[role] = states;
    });
    (semantic.color as Group)[hue] = roles;
  });
  semantic.space = { $type: 'dimension' } as Group;
  ['xs', 's', 'm', 'l', 'xl', 'xxl'].forEach(
    (size, i) =>
      ((semantic.space as Group)[size] = {
        $value: `{base.space.${i * 2 + 1}}`
      })
  );

  // Components: each role in each state, aliasing a semantic role
  const component: Group = { $type: 'color' };

  COMPONENTS.forEach((name, c) => {
    const roles: Group = {};
    const hue = HUES[c % HUES.length];

    ROLES.forEach((role) => {
      const states: Group = {};

      STATES.forEach((state, s) => {
        states[state] = {
          $value: `{semantic.color.${hue}.${role}.${STATES[s]}}`
        };
      });
      roles[role] = states;
    });
    component[name] = roles;
  });

  // Two more alias levels: a theme over the components, a brand over the theme
  const theme: Group = { $type: 'color' };
  const brand: Group = { $type: 'color' };

  COMPONENTS.forEach((name) => {
    theme[name] = {
      background: { $value: `{component.${name}.background.default}` },
      text: { $value: `{component.${name}.text.default}` }
    };
    brand[name] = { accent: { $value: `{theme.${name}.background}` } };
  });

  return { base, palette, semantic, component, theme, brand };
};
