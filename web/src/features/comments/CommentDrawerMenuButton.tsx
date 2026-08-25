import { MessageSquare, MessageSquareOff } from "lucide-react";

import { ActionButtonCountBadge } from "@/src/components/ui/action-button-count-badge";
import { Button, type ButtonProps } from "@/src/components/ui/button";

type CommentDrawerMenuButtonProps = {
  count?: number;
  disabled: boolean;
  onClick?: ButtonProps["onClick"];
};

export function CommentDrawerMenuButton({
  count,
  disabled,
  onClick,
}: CommentDrawerMenuButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 font-normal"
      disabled={disabled}
      onClick={onClick}
      id="comment-drawer-button"
    >
      <span className="flex items-center gap-2">
        {disabled ? (
          <MessageSquareOff className="text-muted-foreground h-4 w-4" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
        <span className="text-sm">Add comment</span>
        {!!count ? <ActionButtonCountBadge count={count} /> : null}
      </span>
    </Button>
  );
}
