from flask import Flask, request, send_file
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression
from fpdf import FPDF
import tempfile
import os

app = Flask(__name__)

@app.route("/analyze", methods=["POST"])
def analyze():
    file = request.files["file"]
    df = pd.read_csv(file) if file.filename.endswith(".csv") else pd.read_fwf(file)

    x = df.iloc[:, 0].values.reshape(-1, 1)
    y = df.iloc[:, 1].values

    model = LinearRegression().fit(x, y)
    r2 = model.score(x, y)
    coef = model.coef_[0]
    intercept = model.intercept_

    fig, ax = plt.subplots()
    ax.scatter(x, y, label="Dati")
    ax.plot(x, model.predict(x), color='red', label='Regressione')
    ax.legend()
    temp_img = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    fig.savefig(temp_img.name)
    plt.close(fig)

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    pdf.cell(200, 10, txt=f"y = {coef:.2f}x + {intercept:.2f}", ln=True)
    pdf.cell(200, 10, txt=f"R² = {r2:.4f}", ln=True)
    pdf.image(temp_img.name, x=10, y=30, w=180)
    temp_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    pdf.output(temp_pdf.name)

    os.unlink(temp_img.name)
    return send_file(temp_pdf.name, as_attachment=True, download_name="report.pdf")
