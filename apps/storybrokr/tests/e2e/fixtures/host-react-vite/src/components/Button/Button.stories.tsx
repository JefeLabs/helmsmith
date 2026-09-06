import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta: Meta<typeof Button> = { title: 'Atoms/Button', component: Button };
export default meta;

export const Primary: StoryObj<typeof Button> = { args: { label: 'Primary' } };
export const Secondary: StoryObj<typeof Button> = { args: { label: 'Secondary' } };
