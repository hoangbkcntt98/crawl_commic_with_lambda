FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y \
        unzip \
        wget \
        tar \
        atk \
        cups-libs \
        gtk3 \
        libXcomposite \
        libXcursor \
        libXdamage \
        libXext \
        libXi \
        libXrandr \
        libXScrnSaver \
        libXtst \
        pango \
        alsa-lib \
        at-spi2-atk \
        libXt \
        nss \
        mesa-libgbm \
        dejavu-sans-fonts \
    && dnf clean all

WORKDIR /opt

ARG CHROME_VERSION=126.0.6478.182

RUN curl -Lo chrome.zip \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip && \
    unzip chrome.zip && rm -f chrome.zip && \
    chmod +x /opt/chrome-linux64/chrome

RUN curl -Lo chromedriver.zip \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip && \
    unzip chromedriver.zip && rm -f chromedriver.zip && \
    chmod +x /opt/chromedriver-linux64/chromedriver

RUN mkdir -p /opt/chrome /opt/chromedriver && \
    mv /opt/chrome-linux64 /opt/chrome/chrome-linux64 && \
    mv /opt/chromedriver-linux64 /opt/chromedriver/chromedriver-linux64

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY app.py ${LAMBDA_TASK_ROOT}/app.py

CMD ["app.lambda_handler"]