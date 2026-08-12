import { useId, type ReactNode } from "react";

interface CardSectionProps {
  /** Rendered as the card's heading. Accepts nodes so a title can carry a count or action. */
  title: ReactNode;
  /** Class for the card surface itself (e.g. `styles.group`, `styles.detailSection`). */
  className?: string;
  /** Class for the heading (e.g. `styles.groupTitle`). */
  titleClassName?: string;
  children: ReactNode;
}

/**
 * A titled card.
 *
 * These were `<fieldset>` + `<legend>`, which looked right until it didn't:
 * a legend is laid out *in the border box*, straddling the top edge rather
 * than sitting inside the padding like a normal first child. On a card with
 * `border: none` the title ends up hovering over the boundary with no
 * relationship to the padding, and because a legend is pulled out of the
 * content flow it also skips the container's flex `gap`, so spacing under it
 * came from nowhere consistent. `display: flex` on a fieldset has its own
 * history of engine-specific bugs on top of that.
 *
 * A `<section>` with a real heading lays out like every other block on the
 * page. `aria-labelledby` keeps the "these controls belong to this group"
 * association that the legend was providing — the one genuinely useful thing
 * a fieldset was doing here, given none of these ever used `disabled`.
 */
export default function CardSection({ title, className, titleClassName, children }: CardSectionProps) {
  const titleId = useId();
  return (
    <section className={className} aria-labelledby={titleId}>
      <h3 id={titleId} className={titleClassName}>
        {title}
      </h3>
      {children}
    </section>
  );
}
