"use client";

import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { Button, Input } from "tdesign-react";
import { StaticTable } from "@/components/ui/StaticTable";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchColumn?: string;
  searchPlaceholder?: string;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = "搜索..."
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20
  });

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      pagination
    }
  });
  const headerGroups = table.getHeaderGroups();
  const visibleHeaders =
    headerGroups.length > 0
      ? headerGroups[headerGroups.length - 1].headers.filter((header) => !header.isPlaceholder)
      : [];
  const tableData = table.getRowModel().rows.map((row) => ({
    id: row.id,
    cells: Object.fromEntries(
      row.getVisibleCells().map((cell) => [
        cell.column.id,
        flexRender(cell.column.columnDef.cell, cell.getContext())
      ])
    ) as Record<string, ReactNode>
  }));
  const tableColumns = visibleHeaders.map((header) => ({
    colKey: header.id,
    title: flexRender(header.column.columnDef.header, header.getContext()),
    cell: ({ row }: { row: { cells: Record<string, ReactNode> } }) => row.cells[header.id] ?? null
  }));

  return (
    <div className="tc-usage-table-wrap">
      {searchColumn ? (
        <div className="mb-3">
          <Input
            placeholder={searchPlaceholder}
            value={(table.getColumn(searchColumn)?.getFilterValue() as string) ?? ""}
            onChange={(value) =>
              table.getColumn(searchColumn)?.setFilterValue(value)
            }
            clearable
          />
        </div>
      ) : null}

      <StaticTable
        className="tc-usage-table"
        columns={tableColumns}
        data={tableData}
        empty="无数据"
      />

      <div className="flex items-center justify-between py-4">
        <div className="text-sm text-gray-500">
          显示 {table.getRowModel().rows.length} 条，共 {data.length} 条
        </div>
        <div className="flex gap-2">
          <Button
            size="small"
            variant="outline"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            上一页
          </Button>
          <span className="flex items-center gap-1 text-sm">
            第 {table.getState().pagination.pageIndex + 1} 页 / 共{" "}
            {table.getPageCount()} 页
          </span>
          <Button
            size="small"
            variant="outline"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
