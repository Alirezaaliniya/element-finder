<?php
namespace ElementorPro\Modules\AtomicForm\Actions;

use ElementorPro\Core\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Email_Settings {
	private $email_settings;

	public function __construct( array $widget_settings ) {
		$this->email_settings = $widget_settings['email'] ?? [];
	}

	public function to() {
		return $this->email_settings['to'] ?? get_option( 'admin_email' );
	}

	public function from() {
		return $this->email_settings['from'] ?? 'email@' . Utils::get_site_domain();
	}

	public function from_name() {
		return $this->email_settings['from-name'] ?? get_bloginfo( 'name' );
	}

	public function subject() {
		return $this->email_settings['subject'] ?? sprintf(
			/* translators: %s: Site title. */
			__( 'New message from "%s"', 'elementor-pro' ),
			get_bloginfo( 'name' )
		);
	}

	public function message() {
		return $this->email_settings['message'] ?? '[all-fields]';
	}

	public function reply_to() {
		return $this->email_settings['reply-to'] ?? $this->from();
	}

	public function cc() {
		return $this->email_settings['cc'] ?? '';
	}

	public function bcc() {
		return $this->email_settings['bcc'] ?? '';
	}

	public function content_type() {
		return $this->email_settings['send-as'] ?? 'html';
	}
}
