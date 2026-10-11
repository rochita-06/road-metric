import pandas as pd

url = "https://archive.ics.uci.edu/ml/machine-learning-databases/00492/Metro_Interstate_Traffic_Volume.csv.gz"

df = pd.read_csv(url)
print(df.head().to_string(index=False))
print(df.columns.tolist())
print("rows", len(df))
