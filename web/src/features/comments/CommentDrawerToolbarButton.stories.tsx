import { expect, fn, userEvent } from "storybook/test";

import preview from "../../../.storybook/preview";
import { CommentDrawerToolbarButton } from "./CommentDrawerToolbarButton";

const meta = preview.meta({
  component: CommentDrawerToolbarButton,
});

export const Default = meta.story({
  args: {
    count: 3,
    variant: "secondary",
    size: "default",
    disabled: false,
    onClick: fn(),
  },
});

export const Disabled = meta.story({
  args: {
    count: 0,
    variant: "secondary",
    size: "default",
    disabled: true,
  },
});

export const OpensComments = meta.story({
  name: "(Test) Opens Comments",
  args: {
    count: 1,
    variant: "secondary",
    size: "default",
    disabled: false,
    onClick: fn(),
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /add comment/i }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
});
