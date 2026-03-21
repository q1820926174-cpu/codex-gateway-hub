"use client";

import type { ReactNode } from "react";
import { Table, type TableProps, type TableRowData } from "tdesign-react";

type StaticTableProps<T extends TableRowData> = {
  columns: NonNullable<TableProps<T>["columns"]>;
  data: T[];
  empty?: ReactNode;
  rowKey?: string;
  className?: string;
};

export function StaticTable<T extends TableRowData>({
  columns,
  data,
  empty,
  rowKey = "id",
  className
}: StaticTableProps<T>) {
  return (
    <Table
      bordered={false}
      className={className}
      columns={columns}
      data={data}
      empty={empty}
      rowKey={rowKey}
      size="small"
      stripe
    />
  );
}
