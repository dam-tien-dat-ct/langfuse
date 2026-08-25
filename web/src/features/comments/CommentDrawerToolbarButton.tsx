import { MessageSquare, MessageSquareOff } from "lucide-react";

import { ActionButtonCountBadge } from "@/src/components/ui/action-button-count-badge";
import { Button, type ButtonProps } from "@/src/components/ui/button";

type CommentDrawerToolbarButtonProps = {
  count?: number;
  variant: NonNullable<ButtonProps["variant"]>;
  size: NonNullable<ButtonProps["size"]>;
  disabled: boolean;
  onClick?: ButtonProps["onClick"];
};

export function CommentDrawerToolbarButton({
  count,
  variant,
  size,
  disabled,
  onClick,
}: CommentDrawerToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={onClick}
      id="comment-drawer-button"
    >
      <span className="flex items-center gap-1">
        {disabled ? (
          <MessageSquareOff
            className={
              size === "sm"
                ? "text-muted-foreground h-3.5 w-3.5"
                : "text-muted-foreground h-4 w-4"
            }
          />
        ) : (
          <MessageSquare
            className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}
          />
        )}
        <span>Add comment</span>
        {!!count ? <ActionButtonCountBadge count={count} /> : null}
      </span>
    </Button>
  );
}
