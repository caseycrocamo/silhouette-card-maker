FROM node:22-bookworm-slim AS node
FROM python:3.13-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libcairo2 libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libgtk-3-0 xvfb xauth fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt pytest==8.4.2 pyinstaller==6.19.0
COPY GUI/package*.json /app/GUI/
RUN cd GUI && npm ci
COPY *.py pyproject.toml /app/
COPY assets /app/assets
COPY plugins /app/plugins
RUN pyinstaller --noconfirm --onefile --add-data '/app/assets:assets' --distpath /app --workpath /tmp/freeze --specpath /tmp pdf_worker.py && pyinstaller --noconfirm --onefile --add-data '/app/assets:assets' --distpath /app/GUI/bin --workpath /tmp/freeze --specpath /tmp translated_text_boxes_to_pdf.py && rm -rf /tmp/freeze
RUN pyinstaller --noconfirm --onefile --collect-submodules plugins --distpath /app/GUI/bin --workpath /tmp/freeze --specpath /tmp card_worker.py && pyinstaller --noconfirm --onefile --add-data '/app/assets:assets' --distpath /app/GUI/bin --workpath /tmp/freeze --specpath /tmp template_worker.py && rm -rf /tmp/freeze
RUN cp /app/pdf_worker /app/GUI/bin/pdf_worker
COPY . /app
RUN npm run build:css
ENV HOME=/tmp/home PYTHONIOENCODING=utf-8 CARD_MAKER_SMOKE_SOURCE_WORKER=/opt/venv/bin/python
ENTRYPOINT ["python", "tests/integration/container.py"]
