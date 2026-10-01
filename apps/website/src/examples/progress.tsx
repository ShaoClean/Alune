import { Progress } from '@alune/ui';

export default function Example() {
  return (
    <>
      <Progress percent={60} />
      <Progress percent={35} status="exception" />
      <Progress percent={100} />
      <Progress type="circle" percent={72} size={80} />
    </>
  );
}
