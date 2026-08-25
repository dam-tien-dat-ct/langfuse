import { CommentDrawerContent } from "@/src/features/comments/CommentDrawerContent";
import { CommentDrawerMenuButton } from "@/src/features/comments/CommentDrawerMenuButton";
import { CommentDrawerToolbarButton } from "@/src/features/comments/CommentDrawerToolbarButton";
import { type ButtonProps } from "@/src/components/ui/button";
import { Drawer, DrawerTrigger } from "@/src/components/ui/drawer";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { type CommentObjectType } from "@langfuse/shared";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { type SelectionData } from "./contexts/InlineCommentSelectionContext";

export function CommentDrawerButton({
  projectId,
  objectId,
  objectType,
  count,
  variant = "secondary",
  size = "default",
  pendingSelection,
  onSelectionUsed,
  onCommentChange,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  layout = "toolbar",
}: {
  projectId: string;
  objectId: string;
  objectType: CommentObjectType;
  count?: number;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  pendingSelection?: SelectionData | null;
  onSelectionUsed?: () => void;
  onCommentChange?: () => void | Promise<void>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * "toolbar" (default) is the inline button; "menu" renders the same drawer
   * trigger as a full-width labeled row for the mobile header overflow popover.
   */
  layout?: "toolbar" | "menu";
}) {
  const isMenu = layout === "menu";
  const router = useRouter();
  const [isMentionDropdownOpen, setIsMentionDropdownOpen] = useState(false);
  const [internalIsDrawerOpen, setInternalIsDrawerOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false); // Track if we've already auto-opened for current deep link

  const isDrawerOpen = controlledIsOpen ?? internalIsDrawerOpen;
  const setIsDrawerOpen = controlledOnOpenChange ?? setInternalIsDrawerOpen;

  const hasReadAccess = useHasProjectAccess({
    projectId,
    scope: "comments:read",
  });
  const hasWriteAccess = useHasProjectAccess({
    projectId,
    scope: "comments:CUD",
  });

  // Auto-open drawer when comments=open query param is present AND matches this drawer's object
  useEffect(() => {
    const shouldAutoOpen =
      router.query.comments === "open" &&
      router.query.commentObjectType === objectType &&
      router.query.commentObjectId === objectId &&
      hasReadAccess &&
      !isDrawerOpen &&
      !hasAutoOpenedRef.current;

    // Only open if drawer is not already open AND we haven't auto-opened yet for this deep link
    if (shouldAutoOpen) {
      hasAutoOpenedRef.current = true;
      setIsDrawerOpen(true);

      // Scroll to specific comment if hash is present
      if (router.asPath.includes("#comment-")) {
        // Wait for drawer animation to complete before scrolling
        setTimeout(() => {
          const hash = router.asPath.split("#")[1];
          const element = document.getElementById(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 300);
      }
    }

    // Reset the flag when query params are cleared (user navigated away from deep link)
    if (router.query.comments !== "open" && hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = false;
    }
  }, [
    router.query.comments,
    router.query.commentObjectType,
    router.query.commentObjectId,
    router.asPath,
    hasReadAccess,
    objectType,
    objectId,
    isDrawerOpen,
    setIsDrawerOpen,
  ]);

  const isDisabled = !hasReadAccess || (!hasWriteAccess && !count);
  const toolbarVariant = variant ?? "secondary";
  const toolbarSize = size ?? "default";

  if (isDisabled) {
    return isMenu ? (
      <CommentDrawerMenuButton count={count} disabled />
    ) : (
      <CommentDrawerToolbarButton
        count={count}
        variant={toolbarVariant}
        size={toolbarSize}
        disabled
      />
    );
  }

  return (
    <Drawer
      open={isDrawerOpen}
      onOpenChange={(open) => {
        // Prevent drawer from closing when mention dropdown is open
        if (!open && isMentionDropdownOpen) {
          // Keep drawer open
          return;
        }
        setIsDrawerOpen(open);

        // Clear URL parameters and hash when drawer is closed
        if (!open && router.query.comments === "open") {
          const { comments, commentObjectType, commentObjectId, ...rest } =
            router.query;
          router.replace(
            {
              pathname: router.pathname,
              query: rest,
            },
            undefined,
            { shallow: true },
          );
        }
      }}
    >
      <DrawerTrigger asChild>
        {isMenu ? (
          <CommentDrawerMenuButton count={count} disabled={false} />
        ) : (
          <CommentDrawerToolbarButton
            count={count}
            variant={toolbarVariant}
            size={toolbarSize}
            disabled={false}
          />
        )}
      </DrawerTrigger>
      <CommentDrawerContent
        projectId={projectId}
        objectId={objectId}
        objectType={objectType}
        isDrawerOpen={isDrawerOpen}
        pendingSelection={pendingSelection}
        onSelectionUsed={onSelectionUsed}
        onCommentChange={onCommentChange}
        onMentionDropdownChange={setIsMentionDropdownOpen}
      />
    </Drawer>
  );
}
