from django.urls import path
from api.views.invoice_views import (
    generate,
    delete_invoice,
    send_invoice,
    company_invoices,
    epv_invoice,
    download_invoice,
    email_log,
)

urlpatterns = [
    path('generate', generate, name='invoice_generate'),
    path('<int:id>', delete_invoice, name='invoice_delete'),
    path('send/<int:id>', send_invoice, name='invoice_send'),
    path('company/<int:clientRecordId>', company_invoices, name='invoice_company'),
    path('epv/<int:verificationId>', epv_invoice, name='invoice_epv'),
    path('download/<str:fileName>', download_invoice, name='invoice_download'),
    path('email-log/<int:clientRecordId>', email_log, name='invoice_email_log'),
]
