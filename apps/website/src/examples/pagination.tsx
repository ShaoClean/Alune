import { useState } from 'react';
import { Pagination } from '@alune/ui';

export default function Example() {
  const [page, setPage] = useState(1);
  return (
    <Pagination
      aria-label="示例分页"
      current={page}
      onChange={setPage}
      total={80}
      pageSize={10}
      showSizeChanger={false}
    />
  );
}
