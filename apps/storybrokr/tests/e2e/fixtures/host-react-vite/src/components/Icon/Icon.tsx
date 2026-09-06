export function Icon({ name }: { name: string }) {
  return (
    <span role="img" aria-label={name}>
      ★
    </span>
  );
}
