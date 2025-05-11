from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
import requests
from io import BytesIO
from fpdf import FPDF

app = Flask(__name__)

def download_file(url):
    res = requests.get(url)
    return BytesIO(res.content)

def best_fit_model(x, y):
    from sklearn.linear_model import LinearRegression
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.metrics import r2_score

    models = {}

    # Lineare
    lin = LinearRegression().fit(x.reshape(-1,1), y)
    r2_lin = r2_score(y, lin.predict(x.reshape(-1,1)))
    models['lineare'] = (r2_lin, lin.coef_.tolist(), lin.intercept_)

    # Polinomiale (grado 2)
    poly = PolynomialFeatures(degree=2)
    x_poly = poly.fit_transform(x.reshape(-1,1))
    poly_reg = LinearRegression().fit(x_poly, y)
    r2_poly = r2_score(y, poly_reg.predict(x_poly))
    models['polinomiale'] = (r2_poly, poly_reg.coef_.tolist(), poly_reg.intercept_)

    # Logaritmico
    x_log = np.log(x[x > 0])
    y_log = y[x > 0]
    if len(x_log) > 1:
        log_reg = LinearRegression().fit(x_log.reshape(-1,1), y_log)
        r2_log = r2_score(y_log, log_reg.predict(x_log.reshape(-1,1)))
        models['logaritmico'] = (r2_log, log_reg.coef_.tolist(), log_reg.intercept_)
    
    best = max(models.items(), key=lambda i: i[1][0])
    return best[0], best[1][0], best[1][1], best[1][2]

def generate_pdf(model, coeffs, r2, intercept):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, txt="Risultati della Regressione", ln=True, align="C")
    pdf.ln(10)
    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"Modello: {model}\nCoefficiente/i: {coeffs}\nIntercetta: {intercept}\nR²: {r2:.4f}")
    output = "/tmp/output.pdf"
    pdf.output(output)
    return output

@app.route("/analizza", methods=["POST"])
def analizza():
    data = request.get_json()
    file_url = data["file_url"]
    file_stream = download_file(file_url)

    if file_url.endswith(".csv"):
        df = pd.read_csv(file_stream)
    else:
        return jsonify({"errore": "Supporto solo per CSV al momento."}), 400

    if df.shape[1] < 2:
        return jsonify({"errore": "Il file deve avere almeno 2 colonne."}), 400

    x = df.iloc[:, 0].values
    y = df.iloc[:, 1].values

    model, r2, coeffs, intercept = best_fit_model(x, y)
    path = generate_pdf(model, coeffs, r2, intercept)

    return jsonify({
        "model": model,
        "coeffs": coeffs,
        "intercept": intercept,
        "r2": r2,
        "pdf_path": path
    })

@app.route("/stima", methods=["POST"])
def stima():
    data = request.get_json()
    modello = data["modello"]
    coeffs = data["coeffs"]
    x = data["x"]

    y = 0
    if modello == "lineare":
        y = coeffs[0] * x + data.get("intercept", 0)
    elif modello == "polinomiale":
        y = sum(c * (x ** i) for i, c in enumerate(coeffs))
    elif modello == "logaritmico":
        y = coeffs[0] * np.log(x) + data.get("intercept", 0)
    else:
        return jsonify({"errore": "Modello non riconosciuto"}), 400

    return jsonify({"x": x, "y": y})

if __name__ == "__main__":
    app.run(debug=True)