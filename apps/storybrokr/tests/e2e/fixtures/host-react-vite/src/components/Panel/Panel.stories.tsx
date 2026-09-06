import type { Meta, StoryObj } from '@storybook/react-vite';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = { title: 'Organisms/Panel', component: Panel };
export default meta;

export const Default: StoryObj<typeof Panel> = { args: { title: 'Panel' } };
