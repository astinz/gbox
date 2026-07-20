import recordsJson from "../../../../../../fixtures/company-records.json" with { type: "json" };

export type CompanyMetricRecord = {
  recordId: string;
  companyId: string;
  metric: string;
  period: string;
  value: string;
  unit: string;
  asOf: string;
  sourceSystem: string;
  version: string;
};

const records = recordsJson as CompanyMetricRecord[];

export function findCompanyMetric(
  companyId: string,
  metric: string,
  period: string,
): CompanyMetricRecord | undefined {
  const target = [companyId, metric, period].map(normalize);
  return records.find((record) =>
    [record.companyId, record.metric, record.period]
      .map(normalize)
      .every((value, index) => value === target[index]),
  );
}

export function listCompanyMetrics(): readonly CompanyMetricRecord[] {
  return records;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[ -]+/g, "_");
}
