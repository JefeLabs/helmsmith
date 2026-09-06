import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';

const meta: Meta<typeof Icon> = { title: 'Atoms/Icon', component: Icon };
export default meta;

export const Star: StoryObj<typeof Icon> = { args: { name: 'star' } };
