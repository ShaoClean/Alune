import { useState } from 'react';
import { Pagination } from '@alune/ui';

export default function Example() {
  const [page, setPage] = useState(1);
  return (
    <div className="example">
      <h2 className="example-title">共 80 条记录，每页 10 条</h2>
      <div className="example-row">
        <Pagination
          aria-label="示例分页"
          current={page}
          onChange={setPage}
          total={80}
          pageSize={10}
          showSizeChanger={false}
        />
      </div>
    </div>
  );
}
