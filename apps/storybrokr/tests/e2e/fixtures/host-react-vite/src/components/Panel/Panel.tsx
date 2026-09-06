import { Icon } from '@ui/Icon/Icon';
import { Button } from '../Button/Button';

export function Panel({ title }: { title: string }) {
  return (
    <section>
      <h2>
        <Icon name="panel" /> {title}
      </h2>
      <Button label="Go" />
    </section>
  );
}
