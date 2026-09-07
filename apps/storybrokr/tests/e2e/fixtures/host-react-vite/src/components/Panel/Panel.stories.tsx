import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = { title: 'Organisms/Panel', component: Panel };
export default meta;

export const Default: StoryObj<typeof Panel> = { args: { title: 'Panel' } };

/** Exercises the child Button and asserts the heading: storybrokr check reports played: true. */
export const WithPlay: StoryObj<typeof Panel> = {
  args: { title: 'Panel' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }));
    await expect(canvas.getByRole('heading')).toHaveTextContent('Panel');
  },
};

/** Deliberately wrong assertion so the e2e suite sees a failing play function. */
export const PlayFails: StoryObj<typeof Panel> = {
  args: { title: 'Panel' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading')).toHaveTextContent('Not the title');
  },
};
