import { expect, fn, userEvent } from "storybook/test";

import preview from "../../../.storybook/preview";
import { CommentDrawerMenuButton } from "./CommentDrawerMenuButton";

const meta = preview.meta({
  component: CommentDrawerMenuButton,
});

export const Default = meta.story({
  args: {
    count: 3,
    disabled: false,
    onClick: fn(),
  },
});

export const Disabled = meta.story({
  args: {
    count: 0,
    disabled: true,
  },
});

export const OpensComments = meta.story({
  name: "(Test) Opens Comments",
  args: {
    count: 1,
    disabled: false,
    onClick: fn(),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /add comment/i }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
});
