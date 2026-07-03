<?php
namespace ElementorPro\Modules\AtomicForm\Actions;

use ElementorPro\Modules\AtomicForm\Actions\Email_Settings;
use ElementorPro\Modules\AtomicForm\Classes\Composite_Shortcode_Resolver as Shortcode_Resolver;
use ElementorPro\Modules\AtomicForm\File_Upload\File_Upload_Handler;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Email_Action extends Action_Base {

	public function get_type(): string {
		return Action_Type::EMAIL;
	}

	public function execute( array $form_data, array $widget_settings, array $context ): array {
		$validation = $this->validate_settings( $widget_settings );

		if ( is_wp_error( $validation ) ) {
			return $this->failure( $validation->get_error_message() );
		}

		$email_settings = new Email_Settings( $widget_settings );

		$to = $email_settings->to();
		$from = $email_settings->from();
		$from_name = $email_settings->from_name();
		$message  = $email_settings->message();
		$subject = $email_settings->subject();
		$reply_to = $email_settings->reply_to();
		$cc = $email_settings->cc();
		$bcc = $email_settings->bcc();
		$content_type = $email_settings->content_type();

		$field_metadata = $context['field_metadata'] ?? [];
		$cssid_map = $context['cssid_map'] ?? [];
		$is_html = 'html' === $content_type;

		$shortcode_resolver = new Shortcode_Resolver( $form_data, $is_html, $field_metadata, $cssid_map );
		$message = $shortcode_resolver->resolve( $message );
		$reply_to = $shortcode_resolver->resolve( $reply_to );

		$headers = [];
		$headers[] = sprintf( 'From: %s <%s>', $from_name, $from );
		$headers[] = sprintf( 'Reply-To: %s', $reply_to );

		if ( 'html' === $content_type ) {
			$headers[] = 'Content-Type: text/html; charset=UTF-8';
		}

		if ( ! empty( $cc ) ) {
			$headers[] = sprintf( 'Cc: %s', $cc );
		}

		if ( ! empty( $bcc ) ) {
			$headers[] = sprintf( 'Bcc: %s', $bcc );
		}

		/**
		 * Filter email headers for atomic forms.
		 *
		 * @param array $headers Email headers.
		 * @param array $form_data Form data.
		 * @param array $widget_settings Widget settings.
		 */
		$headers = apply_filters( 'elementor_pro/atomic_forms/email_headers', $headers, $form_data, $widget_settings );

		/**
		 * Filter email message for atomic forms.
		 *
		 * @param string $message Email message.
		 * @param array $form_data Form data.
		 * @param array $widget_settings Widget settings.
		 */
		$message = apply_filters( 'elementor_pro/atomic_forms/email_message', $message, $form_data, $widget_settings );

		$attachments = $this->collect_attachments( $context );

		$email_sent = wp_mail( $to, $subject, $message, $headers, $attachments );

		if ( ! $email_sent ) {
			return $this->failure( __( 'Failed to send email', 'elementor-pro' ) );
		}

		return $this->success( __( 'Email sent successfully', 'elementor-pro' ) );
	}

	private function collect_attachments( array $context ): array {
		$files = $context['files'] ?? [];

		if ( empty( $files ) ) {
			return [];
		}

		$settings_map = $context['file_field_settings'];
		$attachments = [];

		foreach ( $files as $element_id => $paths ) {
			if ( File_Upload_Handler::MODE_LINK === $settings_map[ $element_id ]['attachment-type'] ) {
				continue;
			}

			$attachments = array_merge( $attachments, $paths );
		}

		return $attachments;
	}

	protected function validate_settings( array $widget_settings ) {
		$email_settings = new Email_Settings( $widget_settings );
		$email_to = $email_settings->to();

		if ( ! empty( $email_to ) && ! is_email( $email_to ) ) {
			$emails = array_map( 'trim', explode( ',', $email_to ) );
			foreach ( $emails as $email ) {
				if ( ! is_email( $email ) ) {
					return new \WP_Error(
						'invalid_email',
						sprintf(
							/* translators: %s: Invalid email address. */
							__( 'Invalid email address: %s', 'elementor-pro' ),
							$email
						)
					);
				}
			}
		}

		return true;
	}

}
